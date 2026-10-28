"""Signals router — grid signals and window scores per plant."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from db.models import FlexLoad, Plant, TariffSchedule
from services.signal_engine import best_windows, compute_signals_for_plant

router = APIRouter(prefix="/signals", tags=["Signals"])


@router.get("/{plant_id}/today", summary="Today's grid signals for a plant")
async def get_today_signals(
    plant_id: int,
    for_date: str | None = Query(None, description="YYYY-MM-DD, defaults to today"),
    db: AsyncSession = Depends(get_db),
):
    plant = await db.get(Plant, plant_id)
    if not plant:
        raise HTTPException(404, "Plant not found")

    target = date.fromisoformat(for_date) if for_date else date.today()

    # Get latest tariff
    ts_result = await db.execute(
        select(TariffSchedule)
        .where(TariffSchedule.plant_id == plant_id)
        .order_by(TariffSchedule.effective_from.desc())
    )
    tariff = ts_result.scalars().first()

    signals = await compute_signals_for_plant(
        plant_id=plant_id,
        state=plant.state,
        archetype=plant.archetype,
        latitude=plant.latitude,
        longitude=plant.longitude,
        base_tariff_rs_per_kwh=tariff.base_rs_per_kwh if tariff else 4.30,
        tariff_slots=tariff.slots if tariff else [],
        for_date=target,
    )
    return {
        "plant_id": plant_id,
        "plant_name": plant.name,
        "date": target.isoformat(),
        "signals": signals,
        "summary": _signals_summary(signals),
    }


@router.get("/{plant_id}/windows", summary="Best scheduling windows for a load")
async def get_windows(
    plant_id: int,
    load_id: int = Query(..., description="FlexLoad ID"),
    for_date: str | None = Query(None, description="YYYY-MM-DD"),
    db: AsyncSession = Depends(get_db),
):
    plant = await db.get(Plant, plant_id)
    if not plant:
        raise HTTPException(404, "Plant not found")

    load = await db.get(FlexLoad, load_id)
    if not load or load.plant_id != plant_id:
        raise HTTPException(404, "Load not found for this plant")

    target = date.fromisoformat(for_date) if for_date else date.today()

    ts_result = await db.execute(
        select(TariffSchedule)
        .where(TariffSchedule.plant_id == plant_id)
        .order_by(TariffSchedule.effective_from.desc())
    )
    tariff = ts_result.scalars().first()

    signals = await compute_signals_for_plant(
        plant_id=plant_id,
        state=plant.state,
        archetype=plant.archetype,
        latitude=plant.latitude,
        longitude=plant.longitude,
        base_tariff_rs_per_kwh=tariff.base_rs_per_kwh if tariff else 4.30,
        tariff_slots=tariff.slots if tariff else [],
        for_date=target,
    )

    windows = best_windows(signals, load.run_hours, load.earliest_start, load.latest_finish)

    return {
        "plant_id": plant_id,
        "load_id": load_id,
        "load_name": load.name,
        "date": target.isoformat(),
        "run_hours": load.run_hours,
        "best_windows": windows,
    }


def _signals_summary(signals: list[dict]) -> dict:
    if not signals:
        return {}
    prices = [s["price_rs_per_kwh"] for s in signals]
    carbons = [s["carbon_kg_per_kwh"] for s in signals]
    scores = [s["window_score"] for s in signals]
    best = min(signals, key=lambda s: s["window_score"])
    worst = max(signals, key=lambda s: s["price_rs_per_kwh"])
    return {
        "avg_price_rs_per_kwh": round(sum(prices) / len(prices), 4),
        "min_price_rs_per_kwh": round(min(prices), 4),
        "max_price_rs_per_kwh": round(max(prices), 4),
        "avg_carbon_kg_per_kwh": round(sum(carbons) / len(carbons), 4),
        "best_window_start": best["block_start_ist"],
        "best_window_score": best["window_score"],
        "peak_blocks": sum(1 for s in signals if s["tod_slot"] == "peak"),
        "solar_rebate_blocks": sum(1 for s in signals if s["tod_slot"] == "solar_rebate"),
        "night_rebate_blocks": sum(1 for s in signals if s["tod_slot"] == "night_rebate"),
        "price_range_rs_per_kwh": round(max(prices) - min(prices), 4),
    }
