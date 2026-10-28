from __future__ import annotations

from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from agents.state import AgentState
from api.routers.advisor import ask_advisor
from api.schemas.input import AdvisorRequest
from db.base import Base
from db.models import Company, FlexLoad, Plant, Recommendation


class StubGraph:
    async def ainvoke(self, state: AgentState) -> AgentState:
        state["collected"] = {"advisor_reply": "Mock answer with plant context."}
        return state


class AdvisorRouterTests(IsolatedAsyncioTestCase):
    async def test_pending_recommendation_context_eager_loads_load_name(self):
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, expire_on_commit=False)

        try:
            async with sessions() as db:
                company = Company(name="Advisor Test Co", short_name="ATC")
                db.add(company)
                await db.flush()
                plant = Plant(company_id=company.id, name="Advisor Test Plant", state="Gujarat")
                db.add(plant)
                await db.flush()
                load = FlexLoad(plant_id=plant.id, name="Test Load", power_kw=100, run_hours=2)
                db.add(load)
                await db.flush()
                db.add(Recommendation(
                    load_id=load.id,
                    recommended_date="2026-10-16",
                    recommended_start="2026-10-16T10:00",
                    recommended_end="2026-10-16T12:00",
                    reason="Test recommendation",
                    status="pending",
                ))
                await db.commit()

                with (
                    patch("api.routers.advisor.compute_signals_for_plant", new=AsyncMock(return_value=[])),
                    patch("api.routers.advisor.compiled_graph", new=StubGraph()),
                ):
                    response = await ask_advisor(
                        AdvisorRequest(question="Explain my pending recommendation", plant_id=plant.id),
                        db,
                    )

                self.assertEqual(response.answer, "Mock answer with plant context.")
        finally:
            await engine.dispose()