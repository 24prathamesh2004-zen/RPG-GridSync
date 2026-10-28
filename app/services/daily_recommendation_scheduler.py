"""In-process daily recommendation job, intended for a single API instance."""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select

from db.base import AsyncSessionLocal
from db.models import Plant
from services.recommendation_generation import generate_for_plant
from shared.config import get_settings

log = logging.getLogger("services.daily_recommendation_scheduler")
_IST = timezone(timedelta(hours=5, minutes=30), name="IST")


def _configured_run_time() -> time:
    try:
        return time.fromisoformat(get_settings().daily_recommendation_time)
    except ValueError:
        log.exception("invalid_daily_recommendation_time; using 06:30 IST")
        return time(6, 30)


async def _run_for_active_plants(target: date) -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Plant.id).where(Plant.is_active == True))
        plant_ids = result.scalars().all()

        for plant_id in plant_ids:
            try:
                outcome = await generate_for_plant(db, plant_id, target)
                log.info(
                    "daily_recommendations_complete plant_id=%s date=%s generated=%d skipped=%d",
                    plant_id,
                    target.isoformat(),
                    len(outcome["recommendations"]),
                    outcome["skipped_existing"],
                )
            except Exception:
                await db.rollback()
                log.exception("daily_recommendations_failed plant_id=%s", plant_id)


async def daily_recommendation_loop() -> None:
    """Generate once daily at configured IST time; manual generation is idempotent."""
    run_time = _configured_run_time()
    while True:
        now = datetime.now(_IST)
        next_run = now.replace(
            hour=run_time.hour,
            minute=run_time.minute,
            second=0,
            microsecond=0,
        )
        if next_run <= now:
            next_run += timedelta(days=1)

        await asyncio.sleep((next_run - now).total_seconds())
        run_date = datetime.now(_IST).date()
        log.info("daily_recommendations_start date=%s", run_date.isoformat())
        await _run_for_active_plants(run_date)