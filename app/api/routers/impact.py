"""Impact router — savings, carbon, ESG rollup."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db
from db.models import Company, LedgerEntry, Plant, Recommendation

router = APIRouter(prefix="/impact", tags=["Impact"])


@router.get("/overview", summary="Group-level impact overview")
async def group_overview(db: AsyncSession = Depends(get_db)):
    """Aggregate savings and carbon across all plants.

    Returns both verified (completed ledger entries) and estimated potential
    (pending + approved recommendations) so the Impact page is useful even
    before any runs are completed.
    """
    # Verified — completed ledger entries
    ledger_result = await db.execute(
        select(
            func.sum(LedgerEntry.avoided_cost_rs).label("total_avoided_cost_rs"),
            func.sum(LedgerEntry.avoided_co2_kg).label("total_avoided_co2_kg"),
            func.sum(LedgerEntry.runs).label("total_runs"),
        )
    )
    row = ledger_result.one()

        # Actionable upside excludes completed and rejected recommendations.
    potential_result = await db.execute(
        select(
            func.sum(Recommendation.estimated_saving_rs).label("potential_saving"),
            func.sum(Recommendation.estimated_carbon_saving_kg).label("potential_carbon"),
            func.count(Recommendation.id).label("total_recs"),
            ).where(Recommendation.status.in_(["pending", "approved"]))
    )
    pot = potential_result.one()

    # Counts by status
    status_result = await db.execute(
        select(Recommendation.status, func.count(Recommendation.id).label("cnt"))
        .group_by(Recommendation.status)
    )
    status_counts = {r.status: r.cnt for r in status_result.all()}

    # Plants with activity
    active_plants_result = await db.execute(
        select(func.count(func.distinct(LedgerEntry.plant_id)))
    )

    return {
        # Verified (completed runs only)
        "total_avoided_cost_rs": round(float(row.total_avoided_cost_rs or 0), 2),
        "total_avoided_co2_kg": round(float(row.total_avoided_co2_kg or 0), 3),
        "total_avoided_co2_tonnes": round(float(row.total_avoided_co2_kg or 0) / 1000, 3),
        "total_runs": int(row.total_runs or 0),
        "active_plants": int(active_plants_result.scalar() or 0),
        # Estimated potential
        "potential_saving_rs": round(float(pot.potential_saving or 0), 2),
        "potential_carbon_kg": round(float(pot.potential_carbon or 0), 3),
        "total_recommendations": int(pot.total_recs or 0),
        # Status breakdown
        "pending_recommendations": status_counts.get("pending", 0),
        "approved_recommendations": status_counts.get("approved", 0),
        "completed_recommendations": status_counts.get("completed", 0),
        "rejected_recommendations": status_counts.get("rejected", 0),
    }


@router.get("/by-plant", summary="Per-plant impact summary")
async def by_plant(db: AsyncSession = Depends(get_db)):
    """Returns verified savings (ledger) merged with estimated potential (recommendations)."""
    # Verified savings from ledger
    ledger_result = await db.execute(
        select(
            LedgerEntry.plant_id,
            func.sum(LedgerEntry.avoided_cost_rs).label("avoided_cost"),
            func.sum(LedgerEntry.avoided_co2_kg).label("avoided_co2"),
            func.sum(LedgerEntry.runs).label("runs"),
        ).group_by(LedgerEntry.plant_id)
    )
    ledger_rows = {r.plant_id: r for r in ledger_result.all()}

    # Estimated potential from all recommendations grouped by plant via flex_load
    from db.models import FlexLoad
    potential_result = await db.execute(
        select(
            FlexLoad.plant_id,
            func.sum(Recommendation.estimated_saving_rs).label("potential_saving"),
            func.sum(Recommendation.estimated_carbon_saving_kg).label("potential_carbon"),
            func.count(Recommendation.id).label("total_recs"),
        )
        .join(FlexLoad, FlexLoad.id == Recommendation.load_id)
            .where(Recommendation.status.in_(["pending", "approved"]))
            .group_by(FlexLoad.plant_id)
    )
    potential_rows = {r.plant_id: r for r in potential_result.all()}

    # Union of all plant IDs seen
    all_plant_ids = set(ledger_rows.keys()) | set(potential_rows.keys())

    if not all_plant_ids:
        return []

    plants_result = await db.execute(select(Plant).where(Plant.id.in_(all_plant_ids)))
    plant_map = {p.id: p.name for p in plants_result.scalars().all()}

    rows = []
    for plant_id in sorted(all_plant_ids):
        l = ledger_rows.get(plant_id)
        p = potential_rows.get(plant_id)
        rows.append({
            "plant_id": plant_id,
            "plant_name": plant_map.get(plant_id, f"Plant {plant_id}"),
            # Verified
            "avoided_cost_rs":  round(float(l.avoided_cost  if l else 0), 2),
            "avoided_co2_kg":   round(float(l.avoided_co2   if l else 0), 3),
            "runs":             int(l.runs                  if l else 0),
            # Estimated potential
            "potential_saving_rs":   round(float(p.potential_saving  if p else 0), 2),
            "potential_carbon_kg":   round(float(p.potential_carbon  if p else 0), 3),
            "total_recommendations": int(p.total_recs                if p else 0),
        })
    return rows


@router.get("/by-company", summary="Per-company impact rollup")
async def by_company(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(
            Plant.company_id,
            func.sum(LedgerEntry.avoided_cost_rs).label("avoided_cost"),
            func.sum(LedgerEntry.avoided_co2_kg).label("avoided_co2"),
            func.sum(LedgerEntry.runs).label("runs"),
        )
        .join(LedgerEntry, LedgerEntry.plant_id == Plant.id)
        .group_by(Plant.company_id)
    )
    rows = result.all()

    company_ids = [r.company_id for r in rows]
    companies_result = await db.execute(select(Company).where(Company.id.in_(company_ids)))
    company_map = {c.id: c.name for c in companies_result.scalars().all()}

    return [
        {
            "company_id": r.company_id,
            "company_name": company_map.get(r.company_id, f"Company {r.company_id}"),
            "avoided_cost_rs": round(float(r.avoided_cost or 0), 2),
            "avoided_co2_kg": round(float(r.avoided_co2 or 0), 3),
            "runs": int(r.runs or 0),
        }
        for r in rows
    ]


@router.get("/value-per-kw", summary="Annual value per kW of flexible demand")
async def value_per_kw(
    plant_id: int = Query(...),
    run_hours: float = Query(4.0, description="Load duration in hours"),
    db: AsyncSession = Depends(get_db),
):
    """Estimate ₹ per kW per year for shifting a flexible load at this plant.

    Uses public tariff data only — no plant meter data required.
    This is the L1 'show the value before asking for data' figure.
    """
    from datetime import date, timedelta
    from services.signal_engine import compute_signals_for_plant
    from db.models import TariffSchedule
    from sqlalchemy import select

    plant = await db.get(Plant, plant_id)
    if not plant:
        from fastapi import HTTPException
        raise HTTPException(404, "Plant not found")

    ts_result = await db.execute(
        select(TariffSchedule)
        .where(TariffSchedule.plant_id == plant_id)
        .order_by(TariffSchedule.effective_from.desc())
    )
    tariff = ts_result.scalars().first()

    # Build 7 days of signals (fast estimate; planning doc says 12 months)
    history = []
    today = date.today()
    for i in range(7):
        day = today - timedelta(days=i)
        signals = await compute_signals_for_plant(
            plant_id=plant_id,
            state=plant.state,
            archetype=plant.archetype,
            latitude=plant.latitude,
            longitude=plant.longitude,
            base_tariff_rs_per_kwh=tariff.base_rs_per_kwh if tariff else 4.30,
            tariff_slots=tariff.slots if tariff else [],
            for_date=day,
        )
        history.append(signals)

    from services.optimizer import estimate_annual_value_per_kw
    value = estimate_annual_value_per_kw(history, run_hours)
    return {
        "plant_id": plant_id,
        "plant_name": plant.name,
        "state": plant.state,
        "run_hours": run_hours,
        **value,
        "note": (
            "Estimate based on ToD tariff structure and IEX price variation. "
            "Multiply by actual flexible kW at the plant for total annual value. "
            "Labelled L1 — does not require plant meter data."
        ),
    }
