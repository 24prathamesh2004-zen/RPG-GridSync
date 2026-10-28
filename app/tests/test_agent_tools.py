from __future__ import annotations

from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from api.routers.agent import (
    AgentContext,
    AgentChatRequest,
    AgentModeRequest,
    ConfirmProposalRequest,
    _one_plant,
    _model_tool_result,
    _blocks_fallback,
    _deterministic_route,
    _run_tool,
    chat,
    confirm_proposal,
    set_agent_mode,
)
from db.base import Base
from db.models import (
    Company,
    FlexLoad,
    LedgerEntry,
    MeterReading,
    Observation,
    Plant,
    PowerSource,
    Recommendation,
)
from shared.cache import get_cache


class AgentToolTests(IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        await get_cache().clear()
        async with self.sessions() as db:
            ceat = Company(name="CEAT Test", short_name="CEAT")
            kec = Company(name="KEC Test", short_name="KEC")
            db.add_all([ceat, kec])
            await db.flush()
            self.ceat = Plant(company_id=ceat.id, name="CEAT Nagpur", state="Maharashtra", archetype="B")
            self.kec = Plant(company_id=kec.id, name="KEC Nagpur", state="Maharashtra", archetype="B")
            db.add_all([self.ceat, self.kec])
            await db.flush()
            self.load = FlexLoad(plant_id=self.ceat.id, name="Curing line", power_kw=100, run_hours=2,
                                 earliest_start="00:00", latest_finish="23:59")
            self.source = PowerSource(plant_id=self.ceat.id, source_type="rooftop_solar", capacity_kw=50)
            db.add_all([self.load, self.source])
            db.add(MeterReading(plant_id=self.ceat.id, block_start_ist="2026-10-23T09:00", kwh=25, kw_avg=100))
            db.add(Observation(data_point_id="frequency", entity=str(self.ceat.id), block_start_ist="2026-10-23T09:00",
                               value=49.97, unit="Hz", status="fresh", source="test"))
            db.add(LedgerEntry(plant_id=self.ceat.id, period_start="2026-10-01", period_end="2026-10-01",
                               avoided_cost_rs=125, avoided_co2_kg=4, runs=1))
            await db.commit()
            self.plant_id = self.ceat.id
            self.load_id = self.load.id
            self.source_id = self.source.id

    async def asyncTearDown(self):
        await self.engine.dispose()

    @staticmethod
    def request() -> Request:
        return Request({"type": "http", "method": "POST", "path": "/api/v1/agent/confirm",
                        "headers": [], "query_string": b"", "server": ("test", 80),
                        "client": ("127.0.0.1", 1234), "scheme": "http"})

    async def test_plant_listing_status_and_nagpur_ambiguity(self):
        async with self.sessions() as db:
            matches = await _one_plant(db, "Nagpur")
            self.assertEqual(matches["error"], "Plant name is ambiguous; ask the user which company/site they mean.")
            self.assertEqual(len(matches["matches"]), 2)
            listed = await _run_tool("list_plants", {"company": "CEAT"}, db, AgentContext(), "test-session")
            self.assertEqual(len(listed), 1)
            status = await _run_tool("get_plant_status", {"plant_id": str(self.plant_id)}, db, AgentContext(), "test-session")
            self.assertEqual(status["flex_loads"][0]["name"], "Curing line")

    async def test_blocks_best_window_dispatch_and_navigation_tools(self):
        blocks = [{"block_start_ist": f"2026-10-23T{index // 4:02d}:{(index % 4) * 15:02d}",
                   "price_rs_per_kwh": 4 + index / 100, "carbon_kg_per_kwh": 0.7,
                   "window_score": index / 96, "captive_availability": 0.5, "tod_slot": "off_peak",
                   "price_source": "fixture", "price_status": "estimated"} for index in range(96)]
        context = AgentContext(plant_id=str(self.plant_id), mode="automated")
        with patch("api.routers.agent.compute_signals_for_plant", new=AsyncMock(return_value=blocks)):
            async with self.sessions() as db:
                signal_result = await _run_tool("get_blocks", {"plant_id": str(self.plant_id),
                    "from_block": 4, "to_block": 5}, db, context, "test-session")
                self.assertEqual(len(signal_result["blocks"]), 2)
                windows = await _run_tool("get_best_window", {"plant_id": str(self.plant_id),
                    "duration_hours": 1}, db, context, "test-session")
                self.assertTrue(windows["windows"])
                dispatch = await _run_tool("get_supplier_dispatch", {"plant_id": str(self.plant_id), "block": 12}, db, context, "test-session")
                self.assertIn("not stored", dispatch["dispatch"])
                navigation = await _run_tool("navigate", {"view": "plant", "id": str(self.plant_id)}, db, context, "test-session")
                self.assertEqual(navigation["action"], "navigate")

    async def test_supplier_frequency_meter_savings_and_schedule_tools(self):
        async with self.sessions() as db:
            sources = await _run_tool("list_suppliers", {}, db, AgentContext(), "test-session")
            self.assertEqual(len(sources), 1)
            source = await _run_tool("get_supplier", {"supplier_id": self.source_id}, db, AgentContext(), "test-session")
            self.assertEqual(source["type"], "rooftop_solar")
            frequency = await _run_tool("compare_frequency", {"entity_ids": [str(self.plant_id)], "block": 0}, db, AgentContext(), "test-session")
            self.assertEqual(frequency[0]["frequency_hz"], 49.97)
            meter = await _run_tool("get_meter", {"plant_id": str(self.plant_id)}, db, AgentContext(), "test-session")
            self.assertEqual(meter["status"], "available")
            supplier_meter = await _run_tool("get_supplier_meter", {"supplier_id": self.source_id}, db, AgentContext(), "test-session")
            self.assertEqual(supplier_meter["status"], "missing")
            savings = await _run_tool("get_savings", {"scope": "CEAT"}, db, AgentContext(), "test-session")
            self.assertEqual(savings["total_avoided_cost_inr"], 125)
            schedule = await _run_tool("get_schedule", {"plant_id": str(self.plant_id)}, db, AgentContext(), "test-session")
            self.assertEqual(schedule, [])

    async def test_proposal_requires_mode_confirmation_and_human_review(self):
        session_id = "test-session-123"
        args = {"plant_id": str(self.plant_id), "load_id": self.load_id,
                "start_ist": "2026-10-24T10:00:00+05:30", "reason": "Lower modeled price window"}
        async with self.sessions() as db:
            advisory = await _run_tool("propose_schedule_change", args, db, AgentContext(mode="advisory"), session_id)
            self.assertIn("Advisory mode", advisory["error"])
            preview = await _run_tool("propose_schedule_change", args, db, AgentContext(mode="automated"), session_id)
            self.assertTrue(preview["requires_explicit_confirmation"])
            self.assertTrue(preview["will_not_execute"])
            count = await db.scalar(select(func.count(Recommendation.id)))
            self.assertEqual(count, 0)
            with self.assertRaises(HTTPException) as denied:
                await confirm_proposal(ConfirmProposalRequest(preview_id=preview["preview_id"], session_id=session_id,
                    confirmed=True, mode="advisory"), self.request(), db)
            self.assertEqual(denied.exception.status_code, 403)
            with self.assertRaises(HTTPException) as untrusted_client_mode:
                await confirm_proposal(ConfirmProposalRequest(preview_id=preview["preview_id"], session_id=session_id,
                    confirmed=True, mode="automated"), self.request(), db)
            self.assertEqual(untrusted_client_mode.exception.status_code, 403)
            await set_agent_mode(AgentModeRequest(session_id=session_id, mode="automated"), self.request())
            result = await confirm_proposal(ConfirmProposalRequest(preview_id=preview["preview_id"], session_id=session_id,
                confirmed=True, mode="automated"), self.request(), db)
            self.assertFalse(result["executed"])
            self.assertEqual(result["status"], "pending human review")
            recommendation = await db.get(Recommendation, result["recommendation_id"])
            self.assertEqual(recommendation.status, "pending")

    async def test_cancel_discards_preview(self):
        session_id = "test-session-cancel"
        args = {"plant_id": str(self.plant_id), "load_id": self.load_id,
                "start_ist": "2026-10-24T10:00:00+05:30", "reason": "Test"}
        async with self.sessions() as db:
            preview = await _run_tool("propose_schedule_change", args, db, AgentContext(mode="automated"), session_id)
            result = await confirm_proposal(ConfirmProposalRequest(preview_id=preview["preview_id"], session_id=session_id,
                confirmed=False, mode="automated"), self.request(), db)
            self.assertTrue(result["cancelled"])
            self.assertIsNone(await get_cache().get(f"agent-preview:{preview['preview_id']}"))

    async def test_existing_recommendation_requires_preview_then_explicit_approval(self):
        session_id = "test-session-approval"
        async with self.sessions() as db:
            recommendation = Recommendation(
                load_id=self.load_id, recommended_date="2026-10-24",
                recommended_start="2026-10-24T10:00:00+05:30",
                recommended_end="2026-10-24T12:00:00+05:30",
                reason="Lower estimated price", status="pending",
            )
            db.add(recommendation)
            await db.commit()
            await db.refresh(recommendation)
            denied = await _run_tool("approve_schedule", {"recommendation_id": recommendation.id}, db,
                                     AgentContext(mode="advisory"), session_id)
            self.assertIn("Advisory mode", denied["error"])
            preview = await _run_tool("approve_schedule", {"recommendation_id": recommendation.id}, db,
                                      AgentContext(mode="automated"), session_id)
            self.assertTrue(preview["requires_explicit_confirmation"])
            self.assertEqual(recommendation.status, "pending")
            await get_cache().set(f"agent-mode:{session_id}", "automated", ttl=3600)
            confirmed = await confirm_proposal(ConfirmProposalRequest(
                preview_id=preview["preview_id"], session_id=session_id, confirmed=True, mode="automated"),
                self.request(), db)
            self.assertEqual(confirmed["status"], "approved; awaiting operational execution")
            self.assertFalse(confirmed["executed"])
            self.assertEqual(recommendation.status, "approved")

    async def test_streamed_agent_caps_actual_tool_executions_at_five(self):
        class StubLLM:
            def __init__(self):
                self.responses = [
                    SimpleNamespace(tool_calls=[
                        {"id": f"call-{index}", "name": "get_supplier_meter", "args": {"supplier_id": index + 1}}
                        for index in range(6)
                    ]),
                    SimpleNamespace(tool_calls=[]),
                ]

            def bind_tools(self, _tools):
                return self

            async def ainvoke(self, _messages):
                return self.responses.pop(0)

            async def astream(self, _messages):
                yield SimpleNamespace(content="Supplier meter readings are missing.")

        body = AgentChatRequest(question="Compare the supplier meter readings for the West region", session_id="stream-test-session",
                                context=AgentContext())
        llm = StubLLM()
        with patch("api.routers.agent.get_llm", return_value=llm), \
            patch("api.routers.agent._deterministic_route", return_value=None), \
                patch("api.routers.agent._run_tool", new=AsyncMock(return_value={"status": "missing"})) as run_tool:
            async with self.sessions() as db:
                response = await chat(body, self.request(), db)
                chunks = [chunk async for chunk in response.body_iterator]
                payload = "".join(chunk.decode() if isinstance(chunk, bytes) else chunk for chunk in chunks)
        self.assertEqual(run_tool.await_count, 5)
        self.assertEqual(payload.count("event: flow"), 5)
        self.assertIn("event: token", payload)
        self.assertIn('"tools_called": 5', payload)

    async def test_96_block_model_payload_is_compact_and_fallback_compares_signals(self):
        blocks = [{"block": index, "block_start_ist": f"2026-10-23T{index // 4:02d}:{(index % 4) * 15:02d}",
                   "plant_id": 5, "price_rs_per_kwh": 4.2 + index / 100,
                   "price_source": "market", "price_status": "fresh",
                   "carbon_kg_per_kwh": 0.7 + index / 1000,
                   "captive_availability": 0.5, "tod_slot": "off_peak", "window_score": index / 100}
                  for index in range(96)]
        result = {"plant": "CEAT Nagpur", "date_ist": "2026-10-23",
                  "units": {"price": "INR/kWh", "carbon": "kgCO2/kWh", "time": "IST"},
                  "provenance": "market/tariff, CEA and weather",
                  "blocks": blocks}
        compact = _model_tool_result("get_blocks", result)
        self.assertEqual(len(compact["blocks"]), 96)
        self.assertLess(len(str(compact)), 9000)
        self.assertNotIn("plant_id", compact["blocks"][0])
        self.assertIn("price_avg_inr_kwh", compact["summary"])
        fallback = _blocks_fallback(result)
        self.assertIn("96 fifteen-minute blocks", fallback)
        self.assertIn("Modeled carbon", fallback)
        self.assertIn("not meter-verified", fallback)

    async def test_flow_bot_common_questions_route_once_without_groq(self):
        blocks = [{"block_start_ist": f"2026-10-23T{index // 4:02d}:{(index % 4) * 15:02d}",
                   "price_rs_per_kwh": 4 + index / 100, "carbon_kg_per_kwh": 0.7 + index / 1000,
                   "window_score": index / 100, "captive_availability": 0.2,
                   "tod_slot": "off_peak", "price_source": "test", "price_status": "estimated"}
                  for index in range(96)]

        async def run_question(question: str, context: AgentContext):
            body = AgentChatRequest(question=question, session_id=f"flow-session-{abs(hash(question))}", context=context)
            with patch("api.routers.agent.get_llm") as get_llm, \
                    patch("api.routers.agent.compute_signals_for_plant", new=AsyncMock(return_value=blocks)):
                async with self.sessions() as db:
                    response = await chat(body, self.request(), db)
                    chunks = [chunk async for chunk in response.body_iterator]
            text = "".join(chunk.decode() if isinstance(chunk, bytes) else chunk for chunk in chunks)
            get_llm.assert_not_called()
            return text

        comparison = await run_question("Compare this plant’s 96-block prices and carbon", AgentContext(plant_id=str(self.plant_id)))
        self.assertIn("event: flow", comparison)
        self.assertIn("96 fifteen-minute blocks", comparison)
        self.assertIn("Modeled carbon", comparison)

        windows = await run_question("Best 2-hour window for CEAT Nagpur", AgentContext())
        self.assertIn('"tool": "get_best_window"', windows)
        self.assertIn("Best modeled operating windows", windows)

        ambiguous = await run_question("Compare Nagpur plant prices", AgentContext())
        self.assertIn('"tool": "list_plants"', ambiguous)
        self.assertIn("Which one did you mean", ambiguous)
        self.assertIn("CEAT CEAT Nagpur", ambiguous)
        self.assertIn("KEC KEC Nagpur", ambiguous)

        plants = await run_question("List CEAT plants in the West region", AgentContext())
        self.assertIn('"tool": "list_plants"', plants)
        self.assertNotIn("CEAT CEAT Nagpur", plants)
        self.assertIn("No registered plants matched those company and region filters", plants)

        two_hour_window = await run_question("What is the best 2-hour window for CEAT Nagpur?", AgentContext())
        self.assertIn("(2.0 hours, IST)", two_hour_window)

        overview_windows = await run_question("Which operating windows look best today?", AgentContext())
        self.assertIn('"tool": "get_best_window"', overview_windows)
        self.assertIn("Best modeled operating windows across registered plants today", overview_windows)
        self.assertIn("CEAT Nagpur", overview_windows)
        self.assertIn("KEC Nagpur", overview_windows)
        self.assertNotIn('"answer_source": "scope guard"', overview_windows)

        outside = await run_question("What is the weather in London?", AgentContext())
        self.assertIn("I can help with GridSync plants", outside)
        self.assertNotIn("event: flow", outside)
        self.assertIn('"tools_called": 0', outside)

    async def test_flow_bot_schedule_lookup_supports_portfolio_scope(self):
        text = await self._stream("Show schedules awaiting review", AgentContext())
        self.assertIn('"tool": "get_schedule"', text)
        self.assertIn('"status": "pending"', text)
        self.assertIn("There are no pending schedule recommendations", text)

    async def test_followup_uses_prior_plant_without_page_context(self):
        blocks = [{"block_start_ist": f"2026-10-23T{index // 4:02d}:{(index % 4) * 15:02d}",
                   "price_rs_per_kwh": 4 + index / 100, "carbon_kg_per_kwh": 0.7 + index / 1000,
                   "window_score": index / 100, "captive_availability": 0.2,
                   "tod_slot": "off_peak", "price_source": "test", "price_status": "estimated"}
                  for index in range(96)]
        body = AgentChatRequest(
            question="What about carbon?",
            session_id="cross-page-followup-session",
            history=[
                {"role": "user", "content": "Compare CEAT Nagpur prices"},
                {"role": "assistant", "content": "I compared the modeled prices for CEAT Nagpur."},
            ],
        )
        with patch("api.routers.agent.get_llm") as get_llm, \
                patch("api.routers.agent.compute_signals_for_plant", new=AsyncMock(return_value=blocks)):
            async with self.sessions() as db:
                response = await chat(body, self.request(), db)
                chunks = [chunk async for chunk in response.body_iterator]
        payload = "".join(chunk.decode() if isinstance(chunk, bytes) else chunk for chunk in chunks)
        get_llm.assert_not_called()
        self.assertIn('"tool": "get_blocks"', payload)
        self.assertIn(f'"plant_id": "{self.plant_id}"', payload)
        self.assertIn("Modeled carbon", payload)

    async def test_short_followup_stays_in_grid_sync_conversation(self):
        class FollowUpLLM:
            def bind_tools(self, _tools):
                return self

            async def ainvoke(self, _messages):
                return SimpleNamespace(tool_calls=[])

            async def astream(self, _messages):
                yield SimpleNamespace(content="That window had the lowest modeled combined score.")

        body = AgentChatRequest(
            question="Why?",
            session_id="short-followup-session",
            history=[
                {"role": "user", "content": "Best 2-hour window for CEAT Nagpur"},
                {"role": "assistant", "content": "The best modeled window is 10:00 to 12:00 IST."},
            ],
        )
        with patch("api.routers.agent.get_llm", return_value=FollowUpLLM()) as get_llm:
            async with self.sessions() as db:
                response = await chat(body, self.request(), db)
                chunks = [chunk async for chunk in response.body_iterator]
        payload = "".join(chunk.decode() if isinstance(chunk, bytes) else chunk for chunk in chunks)
        get_llm.assert_called_once()
        self.assertIn("That window had the lowest modeled combined score.", payload)
        self.assertNotIn('"answer_source": "scope guard"', payload)

    async def _stream(self, question: str, context: AgentContext) -> str:
        body = AgentChatRequest(question=question, session_id=f"flow-helper-{abs(hash(question))}", context=context)
        with patch("api.routers.agent.get_llm") as get_llm:
            async with self.sessions() as db:
                response = await chat(body, self.request(), db)
                chunks = [chunk async for chunk in response.body_iterator]
        get_llm.assert_not_called()
        return "".join(chunk.decode() if isinstance(chunk, bytes) else chunk for chunk in chunks)