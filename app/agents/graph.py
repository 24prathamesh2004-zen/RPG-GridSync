"""GridSync LangGraph — minimal advisor graph.

Flow: supervisor → gridsync_advisor → respond

The advisor uses Groq LLM to explain recommendations and answer grid questions.
"""
from __future__ import annotations

from langgraph.graph import END, StateGraph

from agents.nodes.gridsync_advisor import gridsync_advisor_node
from agents.state import AgentState

_MAX_TURNS = 4


def _supervisor_node(state: AgentState) -> AgentState:
    state["turn_count"] = state.get("turn_count", 0) + 1
    state.setdefault("current_step", "supervisor")
    return state


def _respond_node(state: AgentState) -> AgentState:
    return state


def _route(state: AgentState) -> str:
    if state.get("step_status") == "completed":
        return "respond"
    if state.get("turn_count", 0) >= _MAX_TURNS:
        return "respond"
    return "gridsync_advisor"


def build_graph() -> StateGraph:
    g = StateGraph(AgentState)
    g.add_node("supervisor", _supervisor_node)
    g.add_node("gridsync_advisor", gridsync_advisor_node)
    g.add_node("respond", _respond_node)

    g.set_entry_point("supervisor")
    g.add_conditional_edges("supervisor", _route, {
        "gridsync_advisor": "gridsync_advisor",
        "respond": "respond",
    })
    g.add_edge("gridsync_advisor", "respond")
    g.add_edge("respond", END)
    return g


compiled_graph = build_graph().compile()
