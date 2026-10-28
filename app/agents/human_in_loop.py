"""Human-in-the-loop node — GridSync uses approval via the recommendations API.

The LangGraph human-in-the-loop pattern is not used directly in the advisor flow.
Recommendation approval/rejection is handled via the /recommendations/{id}/approve
and /recommendations/{id}/reject REST endpoints, which are the plant engineer's
approval interface.

This file is kept for future extension if async approval notifications are needed.
"""
from __future__ import annotations

from agents.state import AgentState


def human_review_node(state: AgentState) -> AgentState:
    """Placeholder — not used in current GridSync flow."""
    return state
