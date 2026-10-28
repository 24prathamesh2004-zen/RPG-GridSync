"""Guardrails — lightweight input checks for the GridSync advisor agent.

Currently: pass-through. Add content filtering here if needed.
"""
from __future__ import annotations

from agents.state import AgentState


def guardrails_node(state: AgentState) -> AgentState:
    """Validate input before passing to the advisor."""
    # Trim very long messages to prevent token overflow
    messages = state.get("messages", [])
    for m in messages:
        if m.get("role") == "user" and len(m.get("content", "")) > 2000:
            m["content"] = m["content"][:2000] + "…"
    state["messages"] = messages
    return state
