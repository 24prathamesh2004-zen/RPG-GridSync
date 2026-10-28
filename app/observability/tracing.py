"""Minimal observability — structured logging only.

Phoenix/OpenTelemetry removed to keep dependencies lean.
Add back if needed for production observability.
"""
from __future__ import annotations


def init_tracing(service_name: str = "gridsync-backend") -> None:
    """No-op — tracing not configured for SQLite/local deployment."""
    pass


def instrument_fastapi(app) -> None:
    """No-op — tracing not configured for SQLite/local deployment."""
    pass
