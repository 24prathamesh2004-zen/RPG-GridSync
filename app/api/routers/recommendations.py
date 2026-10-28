"""Recommendations router — generate, list, approve, reject."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.dependencies import get_db
from db.models import (
    FlexLoad,
    LedgerEntry,
    Plant,
    Recommendation,
)
from services.recommendation_generation import generate_for_plant
from shared.config import get_settings

router = APIRouter(prefix="/recommendations", tags=["Recommendations"])
_IST = timezone(timedelta(hours=5, minutes=30), name="IST")


@router.get("/schedule/status", summary="Daily recommendation scheduler status")
async def schedule_status():
    settings = get_settings()
    return {
        "enabled": settings.daily_recommendation_enabled,
        "time": settings.daily_recommendation_time,
        "timezone": "Asia/Kolkata",
    }


@router.post("/generate/{plant_id}", summary="Generate recommendations for a plant")
async def generate(
    plant_id: int,
    for_date: str | None = Query(None, description="YYYY-MM-DD"),
    db: AsyncSession = Depends(get_db),
):
    """Run the optimizer for all active flex loads at a plant and store results."""
    plant = await db.get(Plant, plant_id)
    if not plant:
        raise HTTPException(404, "Plant not found")

    target = date.fromisoformat(for_date) if for_date else datetime.now(_IST).date()

    outcome = await generate_for_plant(db, plant_id, target)
    return {
        "plant_id": plant_id,
        "date": target.isoformat(),
        **outcome,
    }


@router.get("/{plant_id}", summary="List recommendations for a plant")
async def list_recommendations(
    plant_id: int,
    for_date: str | None = Query(None),
    status: str | None = Query(None, description="pending|approved|rejected|completed"),
    db: AsyncSession = Depends(get_db),
):
    plant = await db.get(Plant, plant_id)
    if not plant:
        raise HTTPException(404, "Plant not found")

    loads_result = await db.execute(
        select(FlexLoad).where(FlexLoad.plant_id == plant_id)
    )
    load_ids = {l.id for l in loads_result.scalars().all()}

    query = (
        select(Recommendation)
        .options(selectinload(Recommendation.load))
        .where(Recommendation.load_id.in_(load_ids))
        .order_by(Recommendation.recommended_date.desc(), Recommendation.created_at.desc())
    )
    if for_date:
        query = query.where(Recommendation.recommended_date == for_date)
    if status:
        query = query.where(Recommendation.status == status)

    result = await db.execute(query)
    recs = result.scalars().all()
    return [_rec_dict(r) for r in recs]


@router.post("/{rec_id}/approve", summary="Approve a recommendation")
async def approve(
    rec_id: int,
    actor: str = Query("engineer"),
    db: AsyncSession = Depends(get_db),
):
    rec = await db.get(Recommendation, rec_id)
    if not rec:
        raise HTTPException(404, "Recommendation not found")
    if rec.status not in ("pending",):
        raise HTTPException(400, f"Cannot approve recommendation with status '{rec.status}'")
    rec.status = "approved"
    event = ExecutionEvent(recommendation_id=rec_id, event_type="approved", actor=actor)
    db.add(event)
    await db.commit()
    return {"approved": True, "recommendation_id": rec_id}


@router.post("/{rec_id}/reject", summary="Reject a recommendation")
async def reject(
    rec_id: int,
    reason: str = Query("", description="Reason for rejection"),
    actor: str = Query("engineer"),
    db: AsyncSession = Depends(get_db),
):
    rec = await db.get(Recommendation, rec_id)
    if not rec:
        raise HTTPException(404, "Recommendation not found")
    rec.status = "rejected"
    event = ExecutionEvent(
        recommendation_id=rec_id,
        event_type="rejected",
        actor=actor,
        reason=reason,
    )
    db.add(event)
    await db.commit()
    return {"rejected": True, "recommendation_id": rec_id}


@router.post("/{rec_id}/complete", summary="Mark recommendation as completed (manual/advisory)")
async def complete(
    rec_id: int,
    actor: str = Query("engineer"),
    db: AsyncSession = Depends(get_db),
):
    rec = await db.get(Recommendation, rec_id)
    if not rec:
        raise HTTPException(404, "Recommendation not found")
    if rec.status != "approved":
        raise HTTPException(400, "Can only complete an approved recommendation")
    rec.status = "completed"
    event = ExecutionEvent(recommendation_id=rec_id, event_type="completed", actor=actor)
    db.add(event)

    # Update ledger
    load = await db.get(FlexLoad, rec.load_id)
    if load:
        ledger = LedgerEntry(
            plant_id=load.plant_id,
            period_start=rec.recommended_date,
            period_end=rec.recommended_date,
            avoided_cost_rs=rec.estimated_saving_rs,
            avoided_co2_kg=rec.estimated_carbon_saving_kg,
            runs=1,
        )
        db.add(ledger)

    await db.commit()
    return {"completed": True, "recommendation_id": rec_id}


def _rec_dict(rec: Recommendation) -> dict:
    return {
        "id": rec.id,
        "load_id": rec.load_id,
        "load_name": rec.load.name if rec.load else "",
        "recommended_date": rec.recommended_date,
        "recommended_start": rec.recommended_start,
        "recommended_end": rec.recommended_end,
        "reason": rec.reason,
        "estimated_saving_rs": rec.estimated_saving_rs,
        "estimated_carbon_saving_kg": rec.estimated_carbon_saving_kg,
        "confidence": rec.confidence,
        "status": rec.status,
        "created_at": rec.created_at.isoformat() if rec.created_at else None,
    }
