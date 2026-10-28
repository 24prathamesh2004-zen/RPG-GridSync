"""Context-aware GridSync agent with server-side Groq tool calling."""
from __future__ import annotations

import asyncio
import json
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from langchain_core.messages import ToolMessage
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.dependencies import get_db
from db.models import (
    FlexLoad,
    ExecutionEvent,
    LedgerEntry,
    MeterReading,
    Observation,
    Plant,
    PowerSource,
    Recommendation,
    TariffSchedule,
)
from services.signal_engine import best_windows, compute_signals_for_plant
from shared.cache import get_cache
from shared.llm import get_llm
from shared.logger import get_logger

router = APIRouter(prefix="/agent", tags=["GridSync Agent"])
log = get_logger("api.agent")
IST = timezone(timedelta(hours=5, minutes=30), name="IST")
_rate_lock = asyncio.Lock()
_requests_by_key: dict[str, list[float]] = {}
_RATE_LIMIT = 20
_RATE_WINDOW_SECONDS = 60
_TOOL_LIMIT = 5
_REGION_STATES = {
    "west": {"gujarat", "maharashtra", "goa"},
    "south": {"tamil nadu", "karnataka", "kerala", "andhra pradesh", "telangana"},
    "central": {"madhya pradesh", "chhattisgarh"},
    "north": {"rajasthan", "delhi", "punjab", "haryana", "uttar pradesh"},
}


class AgentMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=4000)


class AgentContext(BaseModel):
    view: str = Field(default="overview", max_length=80)
    plant_id: str | None = Field(default=None, max_length=80)
    block: int | None = Field(default=None, ge=0, le=95)
    mode: str = Field(default="advisory", pattern="^(advisory|automated)$")


class AgentChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    session_id: str = Field(min_length=8, max_length=64)
    history: list[AgentMessage] = Field(default_factory=list, max_length=20)
    context: AgentContext = Field(default_factory=AgentContext)


class AgentModeRequest(BaseModel):
    session_id: str = Field(min_length=8, max_length=64)
    mode: str = Field(pattern="^(advisory|automated)$")


class ConfirmProposalRequest(BaseModel):
    preview_id: str = Field(min_length=20, max_length=64)
    session_id: str = Field(min_length=8, max_length=64)
    confirmed: bool
    mode: str = Field(pattern="^(advisory|automated)$")


TOOL_DEFINITIONS = [
    {"type": "function", "function": {"name": "list_plants", "description": "List registered plants. Use location to disambiguate shared place names such as Nagpur.", "parameters": {"type": "object", "properties": {"region": {"type": "string"}, "company": {"type": "string"}, "location": {"type": "string"}}, "additionalProperties": False}}},
    {"type": "function", "function": {"name": "get_plant_status", "description": "Read plant register, flex loads, tariff and power-source status.", "parameters": {"type": "object", "properties": {"plant_id": {"type": "string"}}, "required": ["plant_id"], "additionalProperties": False}}},
    {"type": "function", "function": {"name": "get_blocks", "description": "Read plant price/carbon/captive signals for 96 quarter-hour blocks. Times are IST.", "parameters": {"type": "object", "properties": {"plant_id": {"type": "string"}, "from_block": {"type": "integer", "minimum": 0, "maximum": 95}, "to_block": {"type": "integer", "minimum": 0, "maximum": 95}}, "required": ["plant_id"], "additionalProperties": False}}},
    {"type": "function", "function": {"name": "get_best_window", "description": "Calculate best load scheduling windows from the plant signal model.", "parameters": {"type": "object", "properties": {"plant_id": {"type": "string"}, "duration_hours": {"type": "number", "minimum": 0.25, "maximum": 24}, "load_id": {"type": "integer"}}, "required": ["plant_id", "duration_hours"], "additionalProperties": False}}},
    {"type": "function", "function": {"name": "get_supplier_dispatch", "description": "Read registered plant power sources. Reports when block-level dispatch data is unavailable.", "parameters": {"type": "object", "properties": {"plant_id": {"type": "string"}, "block": {"type": "integer", "minimum": 0, "maximum": 95}}, "required": ["plant_id", "block"], "additionalProperties": False}}},
    {"type": "function", "function": {"name": "list_suppliers", "description": "List registered power-source types and associated plants. This is not a commercial supplier directory.", "parameters": {"type": "object", "properties": {"region": {"type": "string"}, "type": {"type": "string"}}, "additionalProperties": False}}},
    {"type": "function", "function": {"name": "get_supplier", "description": "Read a registered power-source record by numeric ID. Supplier-plant commercial details may be unavailable.", "parameters": {"type": "object", "properties": {"supplier_id": {"type": "integer"}}, "required": ["supplier_id"], "additionalProperties": False}}},
    {"type": "function", "function": {"name": "compare_frequency", "description": "Read frequency observations for entities and a 15-minute block. Reports missing data instead of estimating.", "parameters": {"type": "object", "properties": {"entity_ids": {"type": "array", "items": {"type": "string"}, "maxItems": 20}, "block": {"type": "integer", "minimum": 0, "maximum": 95}}, "required": ["entity_ids", "block"], "additionalProperties": False}}},
    {"type": "function", "function": {"name": "get_meter", "description": "Read latest plant meter records and explicit availability status.", "parameters": {"type": "object", "properties": {"plant_id": {"type": "string"}}, "required": ["plant_id"], "additionalProperties": False}}},
    {"type": "function", "function": {"name": "get_supplier_meter", "description": "Read supplier injection meter availability. Does not substitute modeled values for missing readings.", "parameters": {"type": "object", "properties": {"supplier_id": {"type": "integer"}}, "required": ["supplier_id"], "additionalProperties": False}}},
    {"type": "function", "function": {"name": "get_savings", "description": "Read ledgered savings only; estimates are not verified savings.", "parameters": {"type": "object", "properties": {"scope": {"type": "string", "description": "all, company short name, plant name, or plant ID"}}, "required": ["scope"], "additionalProperties": False}}},
    {"type": "function", "function": {"name": "get_schedule", "description": "Read pending/approved/completed recommendations for a plant or the full portfolio.", "parameters": {"type": "object", "properties": {"plant_id": {"type": "string"}, "status": {"type": "string", "enum": ["pending", "approved", "rejected", "completed"]}}, "additionalProperties": False}}},
    {"type": "function", "function": {"name": "propose_schedule_change", "description": "Create a no-side-effect preview for moving a flex load. Final submission requires explicit user confirmation; it only creates a pending recommendation for human review.", "parameters": {"type": "object", "properties": {"plant_id": {"type": "string"}, "load_id": {"type": "integer"}, "start_ist": {"type": "string", "description": "ISO timestamp in IST"}, "reason": {"type": "string", "maxLength": 500}}, "required": ["plant_id", "load_id", "start_ist", "reason"], "additionalProperties": False}}},
    {"type": "function", "function": {"name": "approve_schedule", "description": "Prepare a preview to approve an existing pending recommendation. Approval requires explicit confirmation in Automated mode and does not operate equipment.", "parameters": {"type": "object", "properties": {"recommendation_id": {"type": "integer", "minimum": 1}}, "required": ["recommendation_id"], "additionalProperties": False}}},
    {"type": "function", "function": {"name": "navigate", "description": "Offer an in-app navigation action to a supported view.", "parameters": {"type": "object", "properties": {"view": {"type": "string", "enum": ["overview", "plants", "plant", "suppliers", "supplier", "frequency", "meters", "schedule"]}, "id": {"type": "string"}}, "required": ["view"], "additionalProperties": False}}},
]


async def _rate_limit(request: Request, session_id: str | None = None) -> str:
    client = request.client.host if request.client else "unknown"
    now = time.monotonic()
    async with _rate_lock:
        keys = [f"ip:{client}"]
        if session_id:
            keys.append(f"session:{session_id}")
        for key in keys:
            recent = [stamp for stamp in _requests_by_key.get(key, []) if now - stamp < _RATE_WINDOW_SECONDS]
            if len(recent) >= _RATE_LIMIT:
                raise HTTPException(429, "Agent rate limit reached. Try again in a minute.")
        for key in keys:
            recent = [stamp for stamp in _requests_by_key.get(key, []) if now - stamp < _RATE_WINDOW_SECONDS]
            recent.append(now)
            _requests_by_key[key] = recent
    return client


async def _find_plants(db: AsyncSession, selector: str | None = None) -> list[Plant]:
    query = select(Plant).options(
        selectinload(Plant.company),
        selectinload(Plant.power_sources),
        selectinload(Plant.tariff_schedules),
        selectinload(Plant.flex_loads),
    ).where(Plant.is_active.is_(True)).order_by(Plant.name)
    if selector:
        if selector.isdigit():
            query = query.where(Plant.id == int(selector))
        else:
            query = query.where(Plant.name.ilike(f"%{selector.replace('-', ' ')}%"))
    return list((await db.execute(query)).scalars().all())


def _plant_summary(plant: Plant) -> dict[str, Any]:
    return {"id": plant.id, "name": plant.name, "company": plant.company.short_name if plant.company else None,
            "state": plant.state, "region": _plant_region(plant), "utility": plant.utility, "archetype": plant.archetype,
            "data_status": "registered", "power_sources": [{"id": source.id, "type": source.source_type,
            "capacity_kw": source.capacity_kw} for source in plant.power_sources]}


def _plant_region(plant: Plant) -> str:
    if "nagpur" in plant.name.casefold():
        return "central"
    return next((region for region, states in _REGION_STATES.items() if plant.state.casefold() in states), "unknown")


async def _one_plant(db: AsyncSession, selector: str) -> Plant | dict[str, Any]:
    matches = await _find_plants(db, selector)
    if not matches:
        return {"error": "No registered plant matches that selector.", "matches": []}
    if len(matches) > 1:
        return {"error": "Plant name is ambiguous; ask the user which company/site they mean.",
                "matches": [_plant_summary(plant) for plant in matches]}
    return matches[0]


async def _signals(plant: Plant) -> list[dict[str, Any]]:
    tariff = max(plant.tariff_schedules, key=lambda item: item.effective_from, default=None)
    return await compute_signals_for_plant(
        plant_id=plant.id, state=plant.state, archetype=plant.archetype,
        latitude=plant.latitude, longitude=plant.longitude,
        base_tariff_rs_per_kwh=tariff.base_rs_per_kwh if tariff else 4.30,
        tariff_slots=tariff.slots if tariff else [], for_date=datetime.now(IST).date(),
    )


async def _run_tool(name: str, args: dict[str, Any], db: AsyncSession, context: AgentContext, session_id: str) -> Any:
    if name == "list_plants":
        plants = await _find_plants(db)
        region = args.get("region", "").casefold()
        company = args.get("company", "").casefold()
        location = args.get("location", "").casefold()
        return [_plant_summary(plant) for plant in plants if
            (not region or _plant_region(plant) == region or plant.state.casefold() == region) and
                (not company or company in (plant.company.short_name if plant.company else "").casefold()) and
                (not location or location in plant.name.casefold())]

    if name == "get_schedule":
        selector = str(args.get("plant_id") or context.plant_id or "")
        query = select(Recommendation).options(selectinload(Recommendation.load)).join(FlexLoad)
        if selector:
            plant = await _one_plant(db, selector)
            if isinstance(plant, dict):
                return plant
            query = query.where(FlexLoad.plant_id == plant.id)
        if args.get("status"):
            query = query.where(Recommendation.status == args["status"])
        result = await db.execute(query.order_by(Recommendation.recommended_date.desc(), Recommendation.created_at.desc()).limit(100))
        return [{"id": rec.id, "load_id": rec.load_id, "load": rec.load.name if rec.load else None,
                 "plant_id": rec.load.plant_id if rec.load else None,
                 "date": rec.recommended_date, "start_ist": rec.recommended_start,
                 "end_ist": rec.recommended_end, "status": rec.status,
                 "estimated_saving_inr": rec.estimated_saving_rs,
                 "estimated_carbon_kg": rec.estimated_carbon_saving_kg} for rec in result.scalars().all()]

    if name in {"get_plant_status", "get_blocks", "get_best_window", "get_supplier_dispatch", "get_meter"}:
        selector = str(args.get("plant_id") or context.plant_id or "")
        if not selector:
            return {"error": "Plant context is required. Ask which plant the user means."}
        plant = await _one_plant(db, selector)
        if isinstance(plant, dict):
            return plant
        if name == "get_plant_status":
            return {**_plant_summary(plant), "contract_demand_kva": plant.contract_demand_kva,
                    "tariff": [{"effective_from": tariff.effective_from, "base_rs_per_kwh": tariff.base_rs_per_kwh,
                                "slots": tariff.slots} for tariff in plant.tariff_schedules],
                    "flex_loads": [{"id": load.id, "name": load.name, "power_kw": load.power_kw,
                                    "run_hours": load.run_hours, "earliest_start": load.earliest_start,
                                    "latest_finish": load.latest_finish, "mode": load.mode}
                                   for load in plant.flex_loads if load.is_active]}
        if name == "get_blocks":
            blocks = await _signals(plant)
            start, end = args.get("from_block", 0), args.get("to_block", 95)
            if start > end:
                return {"error": "from_block must be less than or equal to to_block."}
            return {"plant": plant.name, "date_ist": datetime.now(IST).date().isoformat(),
                    "units": {"price": "INR/kWh", "carbon": "kgCO2/kWh", "time": "IST"},
                    "provenance": "Computed from market/tariff, CEA carbon and weather sources; per-field source/status included.",
                    "blocks": [{"block": index, **blocks[index]} for index in range(start, end + 1)]}
        if name == "get_best_window":
            duration = float(args["duration_hours"])
            load = await db.get(FlexLoad, args["load_id"]) if args.get("load_id") else None
            if args.get("load_id") and (not load or load.plant_id != plant.id):
                return {"error": "Load does not belong to the selected plant."}
            window = best_windows(await _signals(plant), duration,
                                  load.earliest_start if load else "00:00",
                                  load.latest_finish if load else "23:59")
            return {"plant": plant.name, "duration_hours": duration, "units": "IST, INR/kWh, kgCO2/kWh",
                    "windows": window, "status": "computed model estimate"}
        if name == "get_supplier_dispatch":
            return {"plant": plant.name, "block": args["block"],
                    "sources": [{"id": source.id, "type": source.source_type,
                                 "capacity_kw": source.capacity_kw} for source in plant.power_sources],
                    "dispatch": "Per-supplier quarter-hour dispatch is not stored; no generation claim made."}
        if name == "get_meter":
            result = await db.execute(select(MeterReading).where(MeterReading.plant_id == plant.id)
                                      .order_by(MeterReading.block_start_ist.desc()).limit(8))
            rows = result.scalars().all()
            return {"plant": plant.name, "status": "available" if rows else "missing",
                    "readings": [{"block_start_ist": row.block_start_ist, "kwh": row.kwh,
                                  "kw_avg": row.kw_avg, "power_factor": row.power_factor,
                                  "status": row.status} for row in rows]}
    if name == "list_suppliers":
        query = select(PowerSource, Plant).join(Plant).options(selectinload(Plant.company))
        result = await db.execute(query.order_by(Plant.name))
        rows = result.all()
        wanted_type = str(args.get("type", "")).casefold()
        wanted_region = str(args.get("region", "")).casefold()
        return [{"id": source.id, "type": source.source_type, "capacity_kw": source.capacity_kw,
                 "plant": plant.name, "company": plant.company.short_name if plant.company else None,
                 "state": plant.state, "status": "registered source; supplier commercial directory unavailable"}
                for source, plant in rows if (not wanted_type or wanted_type in source.source_type.casefold())
            and (not wanted_region or _plant_region(plant) == wanted_region or plant.state.casefold() == wanted_region)]

    if name == "get_supplier":
        source = await db.get(PowerSource, args["supplier_id"])
        if not source:
            return {"error": "No registered source matches this ID."}
        plant = await db.get(Plant, source.plant_id)
        return {"id": source.id, "type": source.source_type, "capacity_kw": source.capacity_kw,
                "plant": plant.name if plant else None,
                "status": "Registered power-source record; no commercial supplier details available."}

    if name == "compare_frequency":
        results = []
        for entity in args["entity_ids"]:
            query = select(Observation).where(Observation.entity == entity,
                    Observation.data_point_id == "frequency").order_by(Observation.block_start_ist)
            observations = list((await db.execute(query)).scalars().all())
            row = observations[args["block"]] if len(observations) > args["block"] else None
            results.append({"entity": entity, "block": args["block"],
                            "frequency_hz": row.value if row else None,
                            "status": row.status if row else "missing", "unit": "Hz"})
        return results

    if name == "get_supplier_meter":
        return {"supplier_id": args["supplier_id"], "status": "missing",
                "message": "Supplier injection meter records are not present in the current database."}

    if name == "get_savings":
        query = select(LedgerEntry, Plant).join(Plant).options(selectinload(Plant.company))
        scope = str(args["scope"]).casefold()
        result = await db.execute(query.order_by(LedgerEntry.period_start.desc()).limit(200))
        rows = [(entry, plant) for entry, plant in result.all() if scope in {"all", "group"}
                or scope in plant.name.casefold() or scope in str(plant.id)
                or scope in (plant.company.short_name if plant.company else "").casefold()]
        return {"status": "verified ledger only", "total_avoided_cost_inr": round(sum(row.avoided_cost_rs for row, _ in rows), 2),
                "total_avoided_carbon_kg": round(sum(row.avoided_co2_kg for row, _ in rows), 2),
                "runs": sum(row.runs for row, _ in rows), "records": len(rows)}

    if name == "propose_schedule_change":
        if context.mode != "automated":
            return {"error": "Advisory mode cannot approve or submit schedule changes. Switch to Automated mode to prepare a confirmable proposal."}
        plant = await _one_plant(db, str(args["plant_id"]))
        if isinstance(plant, dict):
            return plant
        load = await db.get(FlexLoad, args["load_id"])
        if not load or load.plant_id != plant.id or not load.is_active:
            return {"error": "Active load not found for the selected plant."}
        try:
            start = datetime.fromisoformat(args["start_ist"])
        except (TypeError, ValueError):
            return {"error": "start_ist must be a valid ISO timestamp with timezone."}
        if start.tzinfo is None:
            return {"error": "start_ist must include an explicit timezone offset."}
        start = start.astimezone(IST)
        end = start + timedelta(hours=load.run_hours)
        if end.date() != start.date():
            return {"error": "The requested run must finish on the same operating day."}
        day = start.date().isoformat()
        if start.strftime("%H:%M") < load.earliest_start or end.strftime("%H:%M") > load.latest_finish:
            return {"error": "Requested window falls outside the load's allowed operating window."}
        preview_id = uuid4().hex
        preview = {"plant_id": plant.id, "plant_name": plant.name, "load_id": load.id,
                   "load_name": load.name, "date": day, "start": start.isoformat(),
                   "end": end.isoformat(), "reason": args["reason"][:500], "session_id": session_id,
                   "kind": "propose"}
        await get_cache().set(f"agent-preview:{preview_id}", preview, ttl=600)
        return {"preview_id": preview_id, "preview": preview, "requires_explicit_confirmation": True,
                "will_create": "pending recommendation for human review", "will_not_execute": True}

    if name == "approve_schedule":
        if context.mode != "automated":
            return {"error": "Advisory mode cannot approve or submit schedule changes. Switch to Automated mode to prepare a confirmable approval."}
        recommendation = await db.get(Recommendation, args["recommendation_id"])
        if not recommendation:
            return {"error": "Recommendation not found."}
        if recommendation.status != "pending":
            return {"error": f"Only pending recommendations can be approved; current status is {recommendation.status}."}
        load = await db.get(FlexLoad, recommendation.load_id)
        plant = await db.get(Plant, load.plant_id) if load else None
        preview_id = uuid4().hex
        preview = {"recommendation_id": recommendation.id,
                   "plant_id": plant.id if plant else None,
                   "plant_name": plant.name if plant else "Unknown plant",
                   "load_name": load.name if load else "Unknown load",
                   "start": recommendation.recommended_start,
                   "end": recommendation.recommended_end,
                   "session_id": session_id, "kind": "approve"}
        await get_cache().set(f"agent-preview:{preview_id}", preview, ttl=600)
        return {"preview_id": preview_id, "preview": preview,
                "requires_explicit_confirmation": True,
                "will_create": "approved recommendation record", "will_not_execute": True}

    if name == "navigate":
        view = args["view"]
        if view in {"plant", "supplier"} and not args.get("id"):
            return {"error": "An id is required for this view."}
        return {"action": "navigate", "view": view, "id": args.get("id")}

    return {"error": "Unsupported tool."}


def _event(name: str, payload: Any) -> str:
    return f"event: {name}\ndata: {json.dumps(payload, ensure_ascii=True, default=str)}\n\n"


def _model_tool_result(name: str, result: Any) -> Any:
    """Keep full evidence in the SSE UI, but trim repetitive fields sent back to Groq."""
    if name != "get_blocks" or not isinstance(result, dict) or not isinstance(result.get("blocks"), list):
        return result

    blocks = result["blocks"]
    prices = [float(block["price_rs_per_kwh"]) for block in blocks if block.get("price_rs_per_kwh") is not None]
    carbons = [float(block["carbon_kg_per_kwh"]) for block in blocks if block.get("carbon_kg_per_kwh") is not None]
    lowest_price = min(blocks, key=lambda item: item.get("price_rs_per_kwh", float("inf")), default=None)
    highest_price = max(blocks, key=lambda item: item.get("price_rs_per_kwh", float("-inf")), default=None)
    lowest_carbon = min(blocks, key=lambda item: item.get("carbon_kg_per_kwh", float("inf")), default=None)
    highest_carbon = max(blocks, key=lambda item: item.get("carbon_kg_per_kwh", float("-inf")), default=None)
    source_counts: dict[str, int] = {}
    for block in blocks:
        key = f"{block.get('price_source', 'unknown')}/{block.get('price_status', 'unknown')}"
        source_counts[key] = source_counts.get(key, 0) + 1

    def extrema(block: dict[str, Any] | None) -> dict[str, Any] | None:
        if not block:
            return None
        return {"block": block.get("block"), "time_ist": str(block.get("block_start_ist", ""))[11:16],
                "price_inr_kwh": block.get("price_rs_per_kwh"), "carbon_kg_kwh": block.get("carbon_kg_per_kwh")}

    return {
        "plant": result.get("plant"),
        "date_ist": result.get("date_ist"),
        "units": "price INR/kWh; carbon kgCO2/kWh; time IST",
        "source_status_counts": source_counts,
        "summary": {
            "price_min_inr_kwh": round(min(prices), 4) if prices else None,
            "price_avg_inr_kwh": round(sum(prices) / len(prices), 4) if prices else None,
            "price_max_inr_kwh": round(max(prices), 4) if prices else None,
            "carbon_min_kg_kwh": round(min(carbons), 4) if carbons else None,
            "carbon_avg_kg_kwh": round(sum(carbons) / len(carbons), 4) if carbons else None,
            "carbon_max_kg_kwh": round(max(carbons), 4) if carbons else None,
            "lowest_price_block": extrema(lowest_price),
            "highest_price_block": extrema(highest_price),
            "lowest_carbon_block": extrema(lowest_carbon),
            "highest_carbon_block": extrema(highest_carbon),
        },
        "blocks": [
            {"b": block.get("block"), "t": str(block.get("block_start_ist", ""))[11:16],
             "p": round(float(block["price_rs_per_kwh"]), 3),
             "c": round(float(block["carbon_kg_per_kwh"]), 4)}
            for block in blocks
            if block.get("price_rs_per_kwh") is not None and block.get("carbon_kg_per_kwh") is not None
        ],
    }


def _blocks_fallback(result: dict[str, Any]) -> str:
    blocks = result.get("blocks", [])
    prices = [float(block["price_rs_per_kwh"]) for block in blocks if block.get("price_rs_per_kwh") is not None]
    carbons = [float(block["carbon_kg_per_kwh"]) for block in blocks if block.get("carbon_kg_per_kwh") is not None]
    if not blocks or not prices or not carbons:
        return "I retrieved the plant signal records, but they do not contain enough price and carbon values to compare."
    low_price = min(blocks, key=lambda block: block.get("price_rs_per_kwh", float("inf")))
    high_price = max(blocks, key=lambda block: block.get("price_rs_per_kwh", float("-inf")))
    low_carbon = min(blocks, key=lambda block: block.get("carbon_kg_per_kwh", float("inf")))
    high_carbon = max(blocks, key=lambda block: block.get("carbon_kg_per_kwh", float("-inf")))

    def point(block: dict[str, Any], field: str, unit: str) -> str:
        return (f"block {int(block['block']) + 1} at {str(block['block_start_ist'])[11:16]} IST "
                f"({float(block[field]):.4f} {unit})")

    return (
        f"I retrieved {len(blocks)} fifteen-minute blocks for {result.get('plant', 'the selected plant')} "
        f"on {result.get('date_ist', 'the selected date')}. These are computed signals, not meter-verified readings. "
        f"Price (INR/kWh) ranges from {min(prices):.4f} to {max(prices):.4f}, averaging {sum(prices) / len(prices):.4f}; "
        f"the lowest is {point(low_price, 'price_rs_per_kwh', 'INR/kWh')} and the highest is "
        f"{point(high_price, 'price_rs_per_kwh', 'INR/kWh')}. "
        f"Modeled carbon (kgCO2/kWh) ranges from {min(carbons):.4f} to {max(carbons):.4f}, "
        f"averaging {sum(carbons) / len(carbons):.4f}; the lowest is "
        f"{point(low_carbon, 'carbon_kg_per_kwh', 'kgCO2/kWh')} and the highest is "
        f"{point(high_carbon, 'carbon_kg_per_kwh', 'kgCO2/kWh')}."
    )


def _resolve_plant_name(
    question: str,
    plants: list[Plant],
    context: AgentContext,
    history: list[AgentMessage] | None = None,
) -> tuple[str | None, list[Plant]]:
    def matches_for(text: str) -> list[Plant]:
        normalized = text.casefold()
        matches = [plant for plant in plants if plant.name.casefold() in normalized]
        if not matches:
            matches = [plant for plant in plants if plant.name.split()[-1].casefold() in normalized]
        return list({plant.id: plant for plant in matches}.values())

    matches = matches_for(question)
    if matches:
        return (str(matches[0].id), []) if len(matches) == 1 else (None, matches)

    for message in reversed(history or []):
        if message.role != "user":
            continue
        previous_matches = matches_for(message.content)
        if len(previous_matches) == 1:
            return str(previous_matches[0].id), []
        if previous_matches:
            companies = [
                plant for plant in previous_matches
                if plant.company and plant.company.short_name.casefold() in question.casefold()
            ]
            if len(companies) == 1:
                return str(companies[0].id), []
            return None, companies or previous_matches

    if context.plant_id:
        context_value = context.plant_id.casefold()
        match = next((plant for plant in plants if str(plant.id) == context_value
                      or plant.name.casefold().replace(" ", "-") == context_value
                      or plant.name.split()[-1].casefold() == context_value.rsplit("-", 1)[-1]), None)
        if match:
            return str(match.id), []
    return None, []


def _question_region(question: str) -> str | None:
    text = question.casefold()
    for region in _REGION_STATES:
        if re.search(rf"\b{region}\b", text):
            return region
    if "nagpur" in text:
        return "central"
    state_to_region = {state: region for region, states in _REGION_STATES.items() for state in states}
    for state, region in state_to_region.items():
        if state in text:
            return region
    return None


def _deterministic_route(question: str) -> tuple[str, dict[str, Any]] | None:
    text = question.casefold()
    if not re.search(r"\b(plant|plants|site|sites|energy|grid|tariff|carbon|price|block|blocks|schedule|schedules|recommendation|recommendations|load|meter|frequency|saving|savings|windows?|operating|supplier|source|dispatch|ceat|kec|nagpur|halol|mysore|jaipur|vadodara|nashik|bhandup|kanchipuram)\b", text):
        return None
    region = _question_region(question)
    duration = re.search(r"\b(\d+(?:\.\d+)?)\s*[- ]?\s*(?:hour|hr)s?\b", text)
    if re.search(r"\b(list|show|which|what are).{0,30}\b(plants|sites)\b", text) or re.search(r"\b(ceat|kec)\s+(plants|sites)\b", text):
        company = "CEAT" if re.search(r"\bceat\b", text) else "KEC" if re.search(r"\bkec\b", text) else None
        location = next((plant for plant in re.findall(r"\b[a-z]+\b", text)
                         if plant in {"halol", "nagpur", "bhandup", "nashik", "mysore", "jaipur", "vadodara", "kanchipuram"}), None)
        return "list_plants", {key: value for key, value in {"company": company, "region": region, "location": location}.items() if value}
    if re.search(r"\b(schedule|schedules|recommendation|recommendations|awaiting review|pending review)\b", text):
        if re.search(r"\b(approve|confirm|move|change|reschedule)\b", text):
            return None
        status = "pending" if re.search(r"\b(awaiting review|pending|to review)\b", text) else None
        return "get_schedule", {"status": status} if status else {}
    if re.search(r"\b(dispatch|generating)\b", text):
        return "get_supplier_dispatch", {"block": 58}
    if re.search(r"\b(best|cheapest|cleanest|operating|shift|window|when should)\b", text) and (duration or "window" in text or "shift" in text):
        return "get_best_window", {"duration_hours": float(duration.group(1)) if duration else 4.0}
    if re.search(r"\b(96|blocks?|price|prices|carbon|emissions|compare)\b", text):
        return "get_blocks", {"from_block": 0, "to_block": 95}
    if re.search(r"\b(supplier|suppliers|source|sources)\b", text):
        return "list_suppliers", {"region": region} if region else {}
    if re.search(r"\b(meter|readings|consumption|demand)\b", text):
        return "get_meter", {}
    if re.search(r"\b(frequency|hz|m\s*hz)\b", text):
        return "compare_frequency", {"block": 58}
    if re.search(r"\b(savings|saved|impact|avoided)\b", text):
        return "get_savings", {"scope": "all"}
    if re.search(r"\b(status|details|tariff|loads|capacity|contract)\b", text):
        return "get_plant_status", {}
    return None


def _is_flow_bot_question(question: str, history: list[AgentMessage] | None = None) -> bool:
    domain_pattern = r"\b(gridsync|grid|plant|plants|site|sites|energy|electricity|power|tariff|carbon|price|block|blocks|schedule|schedules|recommendation|recommendations|load|meter|frequency|saving|windows?|operating|supplier|source|dispatch|ceat|kec|nagpur|halol|mysore|jaipur|vadodara|nashik|bhandup|kanchipuram)\b"
    if re.search(domain_pattern, question.casefold()):
        return True

    text = question.strip().casefold()
    is_follow_up = len(text.split()) <= 12 and re.match(
        r"^(why|how so|what about|and|also|when|where|which|does that|is that|can it|will it|what does that|explain|tell me more|same|then|there|it|that|this)\b",
        text,
    )
    return bool(is_follow_up and any(
        re.search(domain_pattern, message.content.casefold())
        for message in (history or [])[-6:]
    ))


def _answer_from_tool(tool: str, result: Any, args: dict[str, Any] | None = None) -> str:
    args = args or {}
    if isinstance(result, dict) and isinstance(result.get("error"), str):
        matches = result.get("matches")
        if matches:
            names = ", ".join(f"{item.get('company')} {item.get('name')}" for item in matches)
            return f"I found multiple matching sites. Which one did you mean: {names}?"
        return result["error"]
    if tool == "get_blocks" and isinstance(result, dict):
        return _blocks_fallback(result)
    if tool == "get_best_window" and isinstance(result, dict):
        windows = result.get("windows", [])
        if not windows:
            return f"No scheduling windows were returned for {result.get('plant', 'the selected plant')}."
        lines = [f"Best modeled operating windows for {result.get('plant')} ({result.get('duration_hours')} hours, IST):"]
        for index, window in enumerate(windows[:4], 1):
            start = str(window.get("start", ""))
            end = str(window.get("end", ""))
            lines.append(f"{index}. {start[11:16]}–{end[11:16]} · ₹{window.get('avg_price_rs_per_kwh')} /kWh · {window.get('avg_carbon_kg_per_kwh')} kgCO2/kWh average.")
        lines.append("Computed model estimates, not meter-verified results.")
        return "\n".join(lines)
    if tool == "list_plants" and isinstance(result, list):
        if not result:
            return "No registered plants matched those company and region filters."
        names = ", ".join(f"{plant.get('company')} {plant.get('name')} ({plant.get('state')})" for plant in result)
        return f"Registered plants ({len(result)}): {names}."
    if tool == "list_suppliers" and isinstance(result, list):
        if not result:
            return "No registered power sources matched that region or type. The app does not currently have a separate commercial supplier directory."
        names = ", ".join(f"{source.get('type')} at {source.get('plant')} ({source.get('capacity_kw')} kW registered capacity)" for source in result[:12])
        return f"I found {len(result)} registered plant power-source records: {names}. These records do not confirm current generation or dispatch."
    if tool == "get_schedule" and isinstance(result, list):
        if not result:
            if args.get("status") == "pending":
                return "There are no pending schedule recommendations for the selected scope."
            return "There are no schedule recommendations recorded for the selected scope."
        counts: dict[str, int] = {}
        for item in result:
            status = str(item.get("status", "unknown"))
            counts[status] = counts.get(status, 0) + 1
        summary = ", ".join(f"{count} {status}" for status, count in sorted(counts.items()))
        return f"I found {len(result)} schedule recommendation(s): {summary}. Open Schedule to review the details."
    if tool == "get_meter" and isinstance(result, dict):
        if result.get("status") == "missing":
            return f"There are no meter readings recorded for {result.get('plant')}. I won't substitute modeled demand for meter data."
        readings = result.get("readings", [])
        if not readings:
            return f"No meter readings were returned for {result.get('plant')}."
        latest = readings[0]
        return f"Latest available meter reading for {result.get('plant')}: {latest.get('kw_avg')} kW average, {latest.get('kwh')} kWh at {latest.get('block_start_ist')} IST ({latest.get('status')} status)."
    if tool == "get_savings" and isinstance(result, dict):
        return f"Verified ledger totals: ₹{result.get('total_avoided_cost_inr', 0)} avoided cost, {result.get('total_avoided_carbon_kg', 0)} kgCO2 avoided across {result.get('runs', 0)} completed run(s). These are ledgered values only."
    if tool == "get_plant_status" and isinstance(result, dict):
        loads = result.get("flex_loads", [])
        return f"{result.get('company')} {result.get('name')} is registered in {result.get('state')} with {len(loads)} active flexible load(s), {len(result.get('power_sources', []))} registered power source(s), and {result.get('contract_demand_kva')} kVA contract demand."
    if tool == "compare_frequency":
        return "Frequency readings are not available for that entity and block."
    if tool == "get_supplier_dispatch" and isinstance(result, dict):
        return (f"Registered sources for {result.get('plant')} are listed, but per-supplier dispatch for block "
                f"{int(result.get('block', 0)) + 1} is not recorded. I can't confirm which source generated power.")
    return "I completed the requested GridSync lookup, but there is no additional detail to report."


@router.post("/chat", summary="Stream a GridSync tool-calling assistant response")
async def chat(body: AgentChatRequest, request: Request, db: AsyncSession = Depends(get_db)):
    client_ip = await _rate_limit(request, body.session_id)
    history = body.history[-20:]
    if len(history) % 2:
        history = history[:-1]
    log.info("agent.request", session_id=body.session_id, client_ip=client_ip,
             view=body.context.view, plant_id=body.context.plant_id, block=body.context.block)

    async def stream():
        events: list[dict[str, Any]] = []
        try:
            active_mode = await get_cache().get(f"agent-mode:{body.session_id}") or "advisory"
            context = body.context.model_copy(update={"mode": active_mode})
            if not _is_flow_bot_question(body.question, history):
                yield _event("token", {"text": "I can help with GridSync plants, prices, carbon, suppliers, meters, frequency, savings, and schedules. What would you like to check?"})
                yield _event("done", {"tools_called": 0, "answer_source": "scope guard"})
                return

            plants = await _find_plants(db)
            selected_plant_id, named_matches = _resolve_plant_name(
                body.question, plants, context, history
            )
            if selected_plant_id:
                context = context.model_copy(update={"plant_id": selected_plant_id})
            elif named_matches:
                context = context.model_copy(update={"plant_id": None})

            route = _deterministic_route(body.question)
            if route:
                tool_name, tool_args = route
                if named_matches:
                    if len(named_matches) > 1:
                        tool_name = "list_plants"
                        tool_args = {"location": named_matches[0].name.split()[-1]}
                    else:
                        selected_plant_id = str(named_matches[0].id)
                if tool_name == "get_best_window" and not selected_plant_id and not named_matches:
                    portfolio_windows = []
                    for plant in plants:
                        plant_args = {**tool_args, "plant_id": str(plant.id)}
                        result = await _run_tool("get_best_window", plant_args, db, context, body.session_id)
                        log.info("agent.routed_tool", session_id=body.session_id,
                                 tool="get_best_window", args=plant_args)
                        events.append({"tool": "get_best_window", "arguments": plant_args, "result": result})
                        yield _event("flow", events[-1])
                        if isinstance(result, dict):
                            portfolio_windows.extend(
                                {**window, "plant": result.get("plant", plant.name)}
                                for window in result.get("windows", [])
                            )

                    portfolio_windows.sort(key=lambda window: window.get("avg_score", float("inf")))
                    if portfolio_windows:
                        duration_hours = tool_args.get("duration_hours", 4.0)
                        lines = [f"Best modeled operating windows across registered plants today ({duration_hours} hours, IST):"]
                        for index, window in enumerate(portfolio_windows[:5], 1):
                            start = str(window.get("start", ""))
                            end = str(window.get("end", ""))
                            lines.append(
                                f"{index}. {window.get('plant')}: {start[11:16]}–{end[11:16]} IST · "
                                f"₹{window.get('avg_price_rs_per_kwh')} /kWh · "
                                f"{window.get('avg_carbon_kg_per_kwh')} kgCO2/kWh average."
                            )
                        lines.append("Computed model estimates, not meter-verified results.")
                        answer = "\n".join(lines)
                    else:
                        answer = "No operating windows could be calculated because no registered plants returned signal data."
                    yield _event("token", {"text": answer})
                    yield _event("done", {"tools_called": len(events), "answer_source": "GridSync tool result"})
                    return
                if tool_name in {"get_blocks", "get_best_window", "get_plant_status", "get_meter", "get_supplier_dispatch"}:
                    if not selected_plant_id:
                        result = {"error": "Tell me which registered plant you mean so I can look that up."}
                    else:
                        tool_args["plant_id"] = selected_plant_id
                        result = await _run_tool(tool_name, tool_args, db, context, body.session_id)
                elif tool_name == "compare_frequency":
                    if selected_plant_id:
                        tool_args["entity_ids"] = [selected_plant_id]
                        result = await _run_tool(tool_name, tool_args, db, context, body.session_id)
                    else:
                        result = {"error": "Choose a plant before checking its frequency readings."}
                else:
                    if tool_name == "get_schedule" and selected_plant_id:
                        tool_args["plant_id"] = selected_plant_id
                    result = await _run_tool(tool_name, tool_args, db, context, body.session_id)
                log.info("agent.routed_tool", session_id=body.session_id, tool=tool_name, args=tool_args)
                events.append({"tool": tool_name, "arguments": tool_args, "result": result})
                yield _event("flow", events[-1])
                if named_matches and len(named_matches) > 1:
                    choices = ", ".join(f"{plant.company.short_name} {plant.name}" for plant in named_matches)
                    answer = f"I found more than one {named_matches[0].name.split()[-1]} site. Which one did you mean: {choices}?"
                else:
                    answer = _answer_from_tool(tool_name, result, tool_args)
                yield _event("token", {"text": answer})
                yield _event("done", {"tools_called": 1, "answer_source": "GridSync tool result"})
                return

            llm = get_llm(max_tokens=1200, temperature=0.1)
            bound = llm.bind_tools(TOOL_DEFINITIONS)
            system = (
                "You are GridSync Agent, an assistant only for the RPG GridSync energy command center. "
                "Use tools for every factual plant, price, carbon, frequency, schedule, meter, supplier, or savings claim. "
                "Never invent missing values; state source status and distinguish estimates from verified ledger/meter data. "
                "Times are IST; prices INR/kWh; carbon kgCO2/kWh; power kW or kW as returned. "
                "If Nagpur matches multiple companies/sites, ask the user to choose before site-specific analysis. "
                "Frequency bands: within +/-30 mHz is in band; 30-50 mHz deviation is watch; above 50 mHz is out of band. "
                "Do not claim a supplier is generating unless the tool provides generation. Refuse questions unrelated to GridSync. "
                "Advisory mode never approves or submits actions. Even in Automated mode, only prepare a preview; explicit UI confirmation "
                "creates a pending human-review recommendation and never operates equipment. Never say an action executed. "
                "Resolve follow-up references from recent conversation history and the current plant context. Reuse an unambiguous "
                "plant from the conversation; ask a concise clarification when the user has not identified a plant or the name is ambiguous. "
                "Answer the actual question directly, using retrieved evidence rather than generic guidance. "
                f"Current UI context: {context.model_dump_json()}. Session history is bounded to recent turns."
            )
            messages: list[Any] = [("system", system)]
            messages.extend((message.role, message.content) for message in history)
            messages.append(("user", body.question))

            for iteration in range(_TOOL_LIMIT):
                response = await bound.ainvoke(messages)
                tool_calls = getattr(response, "tool_calls", []) or []
                if not tool_calls:
                    break
                messages.append(response)
                for call in tool_calls:
                    if len(events) >= _TOOL_LIMIT:
                        messages.append(ToolMessage(
                            content='{"error":"Tool execution limit reached for this turn."}',
                            tool_call_id=call.get("id", ""),
                        ))
                        continue
                    name = call.get("name", "")
                    args = call.get("args", {})
                    try:
                        result = await _run_tool(name, args, db, context, body.session_id)
                    except (KeyError, TypeError, ValueError) as exc:
                        result = {"error": f"Invalid tool arguments: {str(exc)[:180]}"}
                    log.info("agent.tool", session_id=body.session_id, tool=name,
                             args=args, iteration=iteration + 1)
                    result_text = json.dumps(_model_tool_result(name, result), ensure_ascii=True, default=str)
                    events.append({"tool": name, "arguments": args, "result": result})
                    yield _event("flow", events[-1])
                    messages.append(ToolMessage(content=result_text, tool_call_id=call.get("id", "")))
            else:
                messages.append(("system", "Tool iteration limit reached. Summarize only obtained tool results and state any unresolved data."))

            async for chunk in llm.astream(messages):
                text = chunk.content if isinstance(chunk.content, str) else ""
                if text:
                    yield _event("token", {"text": text})
            yield _event("done", {"tools_called": len(events)})
        except Exception as exc:
            log.exception("agent.failed", session_id=body.session_id)
            if events:
                last_event = events[-1]
                result = last_event.get("result")
                if isinstance(result, dict) and isinstance(result.get("blocks"), list):
                    fallback = _blocks_fallback(result)
                else:
                    fallback = _answer_from_tool(last_event["tool"], result, last_event.get("arguments"))
                if fallback:
                    yield _event("token", {"text": f"I retrieved the GridSync data, but the language service was unavailable. {fallback}"})
                    yield _event("done", {"tools_called": len(events), "answer_source": "tool result fallback"})
                    return
            if getattr(exc, "status_code", None) == 413:
                block_result = next((item["result"] for item in reversed(events)
                                     if item["tool"] == "get_blocks" and isinstance(item["result"], dict)), None)
                if block_result:
                    yield _event("token", {"text": _blocks_fallback(block_result)})
                    yield _event("done", {"tools_called": len(events), "answer_source": "deterministic tool summary"})
                    return
            detail = "GridSync Agent could not complete the request. Check the connection and retry."
            if isinstance(exc, RuntimeError) and "GROQ_API_KEY" in str(exc):
                detail = "GridSync Agent is not configured with a server-side Groq key."
            elif getattr(exc, "status_code", None) == 413:
                detail = "Groq rejected the request because it exceeded the model token budget. Reduce the requested data range and retry."
            elif getattr(exc, "status_code", None) == 429:
                detail = "Groq rate limit reached. Wait briefly and retry."
            yield _event("error", {"message": detail, "retryable": True})

    return StreamingResponse(stream(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no",
    })


@router.post("/mode", summary="Set the server-side operating mode for an Agent session")
async def set_agent_mode(body: AgentModeRequest, request: Request):
    await _rate_limit(request, body.session_id)
    await get_cache().set(f"agent-mode:{body.session_id}", body.mode, ttl=3600)
    log.info("agent.mode_changed", session_id=body.session_id, mode=body.mode)
    return {"session_id": body.session_id, "mode": body.mode}


@router.post("/confirm", summary="Confirm a preview into a pending human-review recommendation")
async def confirm_proposal(body: ConfirmProposalRequest, request: Request, db: AsyncSession = Depends(get_db)):
    await _rate_limit(request, body.session_id)
    key = f"agent-preview:{body.preview_id}"
    preview = await get_cache().get(key)
    if not preview or preview.get("session_id") != body.session_id:
        raise HTTPException(404, "Preview expired or does not belong to this session.")
    if not body.confirmed:
        await get_cache().delete(key)
        return {"cancelled": True, "executed": False}
    active_mode = await get_cache().get(f"agent-mode:{body.session_id}") or "advisory"
    if body.mode != "automated" or active_mode != "automated":
        raise HTTPException(403, "Advisory mode cannot submit or approve schedule changes.")
    if preview.get("kind") == "approve":
        recommendation = await db.get(Recommendation, preview["recommendation_id"])
        if not recommendation or recommendation.status != "pending":
            raise HTTPException(409, "Recommendation is no longer pending; refresh the schedule.")
        recommendation.status = "approved"
        db.add(ExecutionEvent(recommendation_id=recommendation.id, event_type="approved",
                              actor=f"agent-session:{body.session_id[:12]}",
                              reason="User-confirmed GridSync Agent approval; no equipment execution."))
        await db.commit()
        await get_cache().delete(key)
        log.info("agent.schedule_approved", session_id=body.session_id,
                 recommendation_id=recommendation.id)
        return {"submitted": True, "executed": False, "status": "approved; awaiting operational execution",
                "recommendation_id": recommendation.id, "plant": preview["plant_name"],
                "load": preview["load_name"], "start_ist": preview["start"], "end_ist": preview["end"]}
    load = await db.get(FlexLoad, preview["load_id"])
    if not load or not load.is_active or load.plant_id != preview["plant_id"]:
        raise HTTPException(409, "Load configuration changed; create a new preview.")
    start = datetime.fromisoformat(preview["start"])
    end = datetime.fromisoformat(preview["end"])
    recommendation = Recommendation(
        load_id=load.id,
        recommended_date=preview["date"],
        recommended_start=start.isoformat(),
        recommended_end=end.isoformat(),
        reason=preview["reason"],
        status="pending",
        confidence="medium",
        agent_explanation="User-confirmed GridSync Agent proposal; pending human review. No equipment execution.",
    )
    db.add(recommendation)
    await db.commit()
    await get_cache().delete(key)
    log.info("agent.proposal_confirmed", session_id=body.session_id,
             recommendation_id=recommendation.id, plant_id=preview["plant_id"])
    return {"submitted": True, "executed": False, "status": "pending human review",
            "recommendation_id": recommendation.id, "plant": preview["plant_name"],
            "load": preview["load_name"], "start_ist": start.isoformat(), "end_ist": end.isoformat()}