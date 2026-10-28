"""GridSync AgentState — shared contract across all LangGraph nodes."""
from __future__ import annotations

from typing import Any, Literal

from typing_extensions import TypedDict

StepStatus = Literal["pending", "in_progress", "completed", "failed"]


class Message(TypedDict, total=False):
    role: Literal["user", "assistant", "system"]
    agent: str
    content: str


class AgentState(TypedDict, total=False):
    # ── Identity ────────────────────────────────────────────────────────────────
    session_id: str

    # ── Conversation ────────────────────────────────────────────────────────────
    messages: list[Message]

    # ── Routing ─────────────────────────────────────────────────────────────────
    turn_count: int
    current_step: str
    step_status: StepStatus

    # ── GridSync context ─────────────────────────────────────────────────────────
    # Plant and signal context passed from the API
    plant_context: dict[str, Any]
    signals_context: list[dict[str, Any]]
    recommendations_context: list[dict[str, Any]]

    # ── Domain output ───────────────────────────────────────────────────────────
    collected: dict[str, Any]
