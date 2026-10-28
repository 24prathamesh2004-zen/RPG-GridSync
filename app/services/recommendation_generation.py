"""Shared recommendation generation for the API and daily scheduler."""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import (
    ExecutionEvent,
    FlexLoad,
    Plant,
    Recommendation,
    TariffSchedule,
)
from services.optimizer import generate_recommendations


async def generate_for_plant(
    db: AsyncSession, plant_id: int, target: date
) -> dict[str, Any]:
    plant = await db.get(Plant, plant_id)
    if not plant:
        raise LookupError(f"Plant {plant_id} not found")

    loads_result = await db.execute(
        select(FlexLoad).where(
            FlexLoad.plant_id == plant_id,
            FlexLoad.is_active == True,
        )
    )
    loads = loads_result.scalars().all()
    if not loads:
        return {"recommendations": [], "skipped_existing": 0, "active_loads": 0}

    existing_result = await db.execute(
        select(Recommendation.load_id)
        .join(FlexLoad, FlexLoad.id == Recommendation.load_id)
        .where(
            FlexLoad.plant_id == plant_id,
            Recommendation.recommended_date == target.isoformat(),
        )
    )
    existing_load_ids = set(existing_result.scalars().all())
    pending_loads = [load for load in loads if load.id not in existing_load_ids]
    if not pending_loads:
        return {
            "recommendations": [],
            "skipped_existing": len(existing_load_ids),
            "active_loads": len(loads),
        }

    tariff_result = await db.execute(
        select(TariffSchedule)
        .where(TariffSchedule.plant_id == plant_id)
        .order_by(TariffSchedule.effective_from.desc())
    )
    tariff = tariff_result.scalars().first()
    plant_data = {
        "id": plant.id,
        "name": plant.name,
        "state": plant.state,
        "archetype": plant.archetype,
        "latitude": plant.latitude,
        "longitude": plant.longitude,
        "contract_demand_kva": plant.contract_demand_kva,
        "base_tariff_rs_per_kwh": tariff.base_rs_per_kwh if tariff else 4.30,
        "tariff_slots": tariff.slots if tariff else [],
    }
    loads_data = [
        {
            "id": load.id,
            "name": load.name,
            "power_kw": load.power_kw,
            "run_hours": load.run_hours,
            "earliest_start": load.earliest_start,
            "latest_finish": load.latest_finish,
            "can_pause": load.can_pause,
            "min_gap_hours": load.min_gap_hours,
            "must_follow_load_id": load.must_follow_load_id,
            "mode": load.mode,
            "is_active": load.is_active,
        }
        for load in pending_loads
    ]

    proposed = await generate_recommendations(plant_data, loads_data, target)
    for item in proposed:
        recommendation = Recommendation(
            load_id=item["load_id"],
            recommended_date=item["recommended_date"],
            recommended_start=item["recommended_start"],
            recommended_end=item["recommended_end"],
            reason=item["reason"],
            estimated_saving_rs=item["estimated_saving_rs"],
            estimated_carbon_saving_kg=item["estimated_carbon_saving_kg"],
            confidence=item["confidence"],
            status="pending",
        )
        db.add(recommendation)
        await db.flush()
        db.add(ExecutionEvent(
            recommendation_id=recommendation.id,
            event_type="recommended",
            actor="system",
        ))
        item["id"] = recommendation.id

    if proposed:
        await db.commit()

    return {
        "recommendations": proposed,
        "skipped_existing": len(existing_load_ids),
        "active_loads": len(loads),
    }