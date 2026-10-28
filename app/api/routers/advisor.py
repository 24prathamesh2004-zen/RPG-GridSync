"""Advisor router — LLM-powered Q&A and explanation endpoint."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from agents.graph import compiled_graph
from api.dependencies import get_db
from api.schemas.input import AdvisorRequest
from api.schemas.output import AdvisorResponse
from db.models import FlexLoad, Plant, Recommendation, TariffSchedule
from services.signal_engine import compute_signals_for_plant
from shared.logger import get_logger

router = APIRouter(prefix="/advisor", tags=["Advisor"])
log = get_logger("api.advisor")


@router.post("/ask", response_model=AdvisorResponse)
async def ask_advisor(
    req: AdvisorRequest,
    db: AsyncSession = Depends(get_db),
):
    """Ask the GridSync AI advisor a question in the context of a plant."""
    session_id = req.session_id or f"ADV-{uuid.uuid4().hex[:8].upper()}"

    # Build context
    plant_context: dict = {}
    signals_context: list = []
    recommendations_context: list = []

    if req.plant_id:
        plant = await db.get(Plant, req.plant_id)
        if plant:
            plant_context = {
                "id": plant.id,
                "name": plant.name,
                "state": plant.state,
                "archetype": plant.archetype,
                "utility": plant.utility,
            }

            # Get today's signals
            ts_result = await db.execute(
                select(TariffSchedule)
                .where(TariffSchedule.plant_id == req.plant_id)
                .order_by(TariffSchedule.effective_from.desc())
            )
            tariff = ts_result.scalars().first()

            signals_context = await compute_signals_for_plant(
                plant_id=plant.id,
                state=plant.state,
                archetype=plant.archetype,
                latitude=plant.latitude,
                longitude=plant.longitude,
                base_tariff_rs_per_kwh=tariff.base_rs_per_kwh if tariff else 4.30,
                tariff_slots=tariff.slots if tariff else [],
            )

            # Get pending recommendations
            loads_result = await db.execute(
                select(FlexLoad).where(FlexLoad.plant_id == req.plant_id)
            )
            load_ids = {l.id for l in loads_result.scalars().all()}
            if load_ids:
                recs_result = await db.execute(
                    select(Recommendation)
                    .options(selectinload(Recommendation.load))
                    .where(
                        Recommendation.load_id.in_(load_ids),
                        Recommendation.status == "pending",
                    )
                    .order_by(Recommendation.created_at.desc())
                    .limit(5)
                )
                recommendations_context = [
                    {
                        "load_name": r.load.name if r.load else str(r.load_id),
                        "recommended_start": r.recommended_start,
                        "estimated_saving_rs": r.estimated_saving_rs,
                        "estimated_carbon_saving_kg": r.estimated_carbon_saving_kg,
                        "confidence": r.confidence,
                        "reason": r.reason,
                    }
                    for r in recs_result.scalars().all()
                ]

    state = {
        "session_id": session_id,
        "messages": [message.model_dump() for message in req.history]
        + [{"role": "user", "content": req.question}],
        "plant_context": plant_context,
        "signals_context": signals_context,
        "recommendations_context": recommendations_context,
        "collected": {},
        "turn_count": 0,
        "step_status": "in_progress",
    }

    result = dict(await compiled_graph.ainvoke(state))
    reply = result.get("collected", {}).get(
        "advisor_reply",
        "I could not generate a response. Please check your GROQ_API_KEY.",
    )

    messages = result.get("messages", [])
    return AdvisorResponse(
        session_id=session_id,
        answer=reply,
        messages=messages,
    )
