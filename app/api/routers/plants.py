"""Plants and companies CRUD router."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.dependencies import get_db
from db.models import Company, FlexLoad, LedgerEntry, Plant, PowerSource, TariffSchedule
from api.schemas.input import (
    CompanyCreate,
    FlexLoadCreate,
    PlantCreate,
    PowerSourceCreate,
    TariffScheduleCreate,
)

router = APIRouter(prefix="/plants", tags=["Plants"])


# ── Companies ──────────────────────────────────────────────────────────────────

@router.get("/companies", summary="List all companies")
async def list_companies(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Company).order_by(Company.name))
    return [
        {"id": c.id, "name": c.name, "short_name": c.short_name, "sector": c.sector}
        for c in result.scalars().all()
    ]


@router.post("/companies", summary="Create a company", status_code=201)
async def create_company(body: CompanyCreate, db: AsyncSession = Depends(get_db)):
    company = Company(**body.model_dump())
    db.add(company)
    await db.commit()
    await db.refresh(company)
    return {"id": company.id, "name": company.name}


# ── Plants ─────────────────────────────────────────────────────────────────────

@router.get("/", summary="List all plants")
async def list_plants(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Plant)
        .options(selectinload(Plant.company), selectinload(Plant.power_sources))
        .where(Plant.is_active == True)
        .order_by(Plant.name)
    )
    plants = result.scalars().all()
    return [_plant_summary(p) for p in plants]


@router.get("/{plant_id}", summary="Get plant detail")
async def get_plant(plant_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Plant)
        .options(
            selectinload(Plant.company),
            selectinload(Plant.power_sources),
            selectinload(Plant.tariff_schedules),
            selectinload(Plant.flex_loads),
        )
        .where(Plant.id == plant_id)
    )
    plant = result.scalar_one_or_none()
    if not plant:
        raise HTTPException(404, f"Plant {plant_id} not found")
    return _plant_detail(plant)


@router.post("/", summary="Create a plant", status_code=201)
async def create_plant(body: PlantCreate, db: AsyncSession = Depends(get_db)):
    # Validate company exists
    company = await db.get(Company, body.company_id)
    if not company:
        raise HTTPException(404, f"Company {body.company_id} not found")
    plant = Plant(**body.model_dump())
    db.add(plant)
    await db.commit()
    await db.refresh(plant)
    return {"id": plant.id, "name": plant.name}


@router.patch("/{plant_id}", summary="Update plant")
async def update_plant(plant_id: int, body: dict, db: AsyncSession = Depends(get_db)):
    plant = await db.get(Plant, plant_id)
    if not plant:
        raise HTTPException(404, "Plant not found")
    allowed = {"utility", "archetype", "latitude", "longitude",
               "contract_demand_kva", "tariff_category", "notes", "is_active"}
    for k, v in body.items():
        if k in allowed:
            setattr(plant, k, v)
    await db.commit()
    return {"updated": True}


# ── Power Sources ──────────────────────────────────────────────────────────────

@router.post("/{plant_id}/power-sources", status_code=201)
async def add_power_source(plant_id: int, body: PowerSourceCreate, db: AsyncSession = Depends(get_db)):
    plant = await db.get(Plant, plant_id)
    if not plant:
        raise HTTPException(404, "Plant not found")
    ps = PowerSource(plant_id=plant_id, **body.model_dump())
    db.add(ps)
    await db.commit()
    await db.refresh(ps)
    return {"id": ps.id}


# ── Tariff Schedules ───────────────────────────────────────────────────────────

@router.post("/{plant_id}/tariff", status_code=201)
async def add_tariff(plant_id: int, body: TariffScheduleCreate, db: AsyncSession = Depends(get_db)):
    plant = await db.get(Plant, plant_id)
    if not plant:
        raise HTTPException(404, "Plant not found")
    ts = TariffSchedule(plant_id=plant_id, **body.model_dump())
    db.add(ts)
    await db.commit()
    await db.refresh(ts)
    return {"id": ts.id}


# ── Flex Loads ─────────────────────────────────────────────────────────────────

@router.get("/{plant_id}/loads", summary="List flex loads")
async def list_loads(plant_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(FlexLoad)
        .where(FlexLoad.plant_id == plant_id, FlexLoad.is_active == True)
        .order_by(FlexLoad.name)
    )
    return [_load_dict(l) for l in result.scalars().all()]


@router.post("/{plant_id}/loads", status_code=201)
async def create_load(plant_id: int, body: FlexLoadCreate, db: AsyncSession = Depends(get_db)):
    plant = await db.get(Plant, plant_id)
    if not plant:
        raise HTTPException(404, "Plant not found")
    load = FlexLoad(plant_id=plant_id, **body.model_dump())
    db.add(load)
    await db.commit()
    await db.refresh(load)
    return {"id": load.id, "name": load.name}


@router.patch("/{plant_id}/loads/{load_id}")
async def update_load(plant_id: int, load_id: int, body: dict, db: AsyncSession = Depends(get_db)):
    load = await db.get(FlexLoad, load_id)
    if not load or load.plant_id != plant_id:
        raise HTTPException(404, "Load not found")
    allowed = {"mode", "is_active", "earliest_start", "latest_finish",
               "can_pause", "min_gap_hours", "notes"}
    for k, v in body.items():
        if k in allowed:
            setattr(load, k, v)
    await db.commit()
    return {"updated": True}


# ── Impact / Ledger ────────────────────────────────────────────────────────────

@router.get("/{plant_id}/ledger")
async def plant_ledger(plant_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(LedgerEntry)
        .where(LedgerEntry.plant_id == plant_id)
        .order_by(LedgerEntry.period_start.desc())
    )
    entries = result.scalars().all()
    return [
        {
            "period_start": e.period_start,
            "period_end": e.period_end,
            "avoided_cost_rs": e.avoided_cost_rs,
            "avoided_co2_kg": e.avoided_co2_kg,
            "runs": e.runs,
        }
        for e in entries
    ]


# ── Helpers ────────────────────────────────────────────────────────────────────

def _plant_summary(plant: Plant) -> dict:
    return {
        "id": plant.id,
        "name": plant.name,
        "company": plant.company.short_name if plant.company else "",
        "state": plant.state,
        "archetype": plant.archetype,
        "utility": plant.utility,
        "power_sources": [ps.source_type for ps in plant.power_sources],
    }


def _plant_detail(plant: Plant) -> dict:
    return {
        "id": plant.id,
        "name": plant.name,
        "company_id": plant.company_id,
        "company": plant.company.name if plant.company else "",
        "state": plant.state,
        "utility": plant.utility,
        "archetype": plant.archetype,
        "latitude": plant.latitude,
        "longitude": plant.longitude,
        "contract_demand_kva": plant.contract_demand_kva,
        "tariff_category": plant.tariff_category,
        "notes": plant.notes,
        "power_sources": [
            {"id": ps.id, "source_type": ps.source_type, "capacity_kw": ps.capacity_kw}
            for ps in plant.power_sources
        ],
        "tariff_schedules": [
            {
                "id": ts.id,
                "effective_from": ts.effective_from,
                "base_rs_per_kwh": ts.base_rs_per_kwh,
                "slots": ts.slots,
            }
            for ts in plant.tariff_schedules
        ],
        "flex_loads": [_load_dict(l) for l in plant.flex_loads if l.is_active],
    }


def _load_dict(load: FlexLoad) -> dict:
    return {
        "id": load.id,
        "name": load.name,
        "power_kw": load.power_kw,
        "run_hours": load.run_hours,
        "earliest_start": load.earliest_start,
        "latest_finish": load.latest_finish,
        "can_pause": load.can_pause,
        "min_gap_hours": load.min_gap_hours,
        "mode": load.mode,
        "is_active": load.is_active,
    }
