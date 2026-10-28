from __future__ import annotations

from datetime import date
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from db.base import Base
from db.models import Company, FlexLoad, Plant, Recommendation
from ingestion.connectors.iex import _parse_energymap_response
import services.recommendation_generation as recommendation_generation


class EnergyMapParsingTests(IsolatedAsyncioTestCase):
    async def test_converts_utc_blocks_to_ist_and_filters_delivery_date(self):
        payload = {
            "data": [
                {"timestamp": "2026-10-15T18:30:00Z", "mcp_rs_mwh": "5205.55", "mcv_mw": "12"},
                {"timestamp": "2026-10-15T18:45:00Z", "mcp_rs_mwh": "5100", "mcv_mw": 8},
                {"timestamp": "2026-10-15T17:00:00Z", "mcp_rs_mwh": "9999", "mcv_mw": 4},
            ]
        }

        records = _parse_energymap_response(payload, date(2026, 10, 16), "DAM")

        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["block_start_ist"], "2026-10-16T00:00")
        self.assertEqual(records[0]["price_rs_per_mwh"], 5205.55)
        self.assertEqual(records[0]["volume_mwh"], 3.0)
        self.assertEqual(records[0]["source"], "energymap_dam")


class DailyRecommendationIdempotencyTests(IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)

        async with self.sessions() as db:
            company = Company(name="Test Company", short_name="TEST")
            db.add(company)
            await db.flush()
            plant = Plant(company_id=company.id, name="Test Plant", state="Gujarat")
            db.add(plant)
            await db.flush()
            for name in ("Load A", "Load B"):
                db.add(FlexLoad(
                    plant_id=plant.id,
                    name=name,
                    power_kw=100,
                    run_hours=1,
                ))
            await db.commit()
            self.plant_id = plant.id

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def test_repeated_generation_only_creates_one_recommendation_per_load_day(self):
        async def fake_optimizer(plant, loads, target):
            return [
                {
                    "load_id": load["id"],
                    "recommended_date": target.isoformat(),
                    "recommended_start": f"{target.isoformat()}T10:00",
                    "recommended_end": f"{target.isoformat()}T11:00",
                    "reason": "Test schedule",
                    "estimated_saving_rs": 100.0,
                    "estimated_carbon_saving_kg": 2.0,
                    "confidence": "medium",
                }
                for load in loads
            ]

        target = date(2026, 10, 16)
        with patch.object(recommendation_generation, "generate_recommendations", fake_optimizer):
            async with self.sessions() as db:
                first = await recommendation_generation.generate_for_plant(
                    db, self.plant_id, target
                )
            async with self.sessions() as db:
                second = await recommendation_generation.generate_for_plant(
                    db, self.plant_id, target
                )

        self.assertEqual(len(first["recommendations"]), 2)
        self.assertEqual(len(second["recommendations"]), 0)
        self.assertEqual(second["skipped_existing"], 2)

        async with self.sessions() as db:
            rows = await db.execute(
                Recommendation.__table__.select().where(
                    Recommendation.recommended_date == target.isoformat()
                )
            )
            self.assertEqual(len(rows.all()), 2)