from __future__ import annotations

from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from agents.nodes.gridsync_advisor import gridsync_advisor_node
from api.schemas.input import AdvisorRequest


class RecordingLLM:
    def __init__(self) -> None:
        self.messages = []

    async def ainvoke(self, messages):
        self.messages = messages
        return AIMessage(content="Use the 10:00 window; it is an estimate.")


class AdvisorConversationTests(IsolatedAsyncioTestCase):
    async def test_node_sends_recent_history_and_current_question_in_order(self):
        llm = RecordingLLM()
        state = {
            "session_id": "ADV-TEST",
            "messages": [
                {"role": "user", "content": "Which window is best?"},
                {"role": "assistant", "content": "The 10:00 window is best."},
                {"role": "user", "content": "Why that one?"},
            ],
            "plant_context": {"name": "Test Plant", "state": "Gujarat"},
            "signals_context": [],
            "recommendations_context": [],
            "collected": {},
        }

        with patch("shared.llm.get_llm", return_value=llm):
            result = await gridsync_advisor_node(state)

        self.assertIsInstance(llm.messages[0], SystemMessage)
        self.assertIsInstance(llm.messages[1], HumanMessage)
        self.assertIsInstance(llm.messages[2], AIMessage)
        self.assertIsInstance(llm.messages[3], HumanMessage)
        self.assertEqual(llm.messages[1].content, "Which window is best?")
        self.assertEqual(llm.messages[2].content, "The 10:00 window is best.")
        self.assertEqual(llm.messages[3].content, "Why that one?")
        self.assertEqual(result["collected"]["advisor_reply"], "Use the 10:00 window; it is an estimate.")

    async def test_request_bounds_history_and_message_size(self):
        request = AdvisorRequest(
            question="Follow up?",
            history=[{"role": "assistant", "content": "Previous response."}],
        )
        self.assertEqual(len(request.history), 1)

        with self.assertRaises(ValueError):
            AdvisorRequest(
                question="Follow up?",
                history=[{"role": "user", "content": str(index)} for index in range(11)],
            )