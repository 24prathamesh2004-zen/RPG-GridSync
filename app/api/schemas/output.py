"""Response schemas for GridSync API."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class AdvisorResponse(BaseModel):
    session_id: str
    answer: str
    messages: list[dict[str, Any]] = []
