"""Request schemas for GridSync API."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field
from typing_extensions import Literal


class CompanyCreate(BaseModel):
    name: str
    short_name: str
    sector: str = "Industrial"


class PlantCreate(BaseModel):
    company_id: int
    name: str
    state: str
    utility: str = ""
    archetype: str = Field("A", pattern="^[ABC]$")
    latitude: float | None = None
    longitude: float | None = None
    contract_demand_kva: float = 0.0
    tariff_category: str = "HT-Industrial"
    notes: str = ""


class PowerSourceCreate(BaseModel):
    source_type: str = Field(
        ...,
        description="utility | rooftop_solar | captive_wind | captive_solar | captive_hybrid | open_access | ppa"
    )
    capacity_kw: float = 0.0
    matching_rule: str = ""
    notes: str = ""


class TariffScheduleCreate(BaseModel):
    effective_from: str = Field(..., description="YYYY-MM-DD")
    base_rs_per_kwh: float = 4.30
    demand_charge_rs_per_kva: float = 0.0
    slots: list[dict[str, Any]] = Field(
        default_factory=list,
        description=(
            '[{"name":"peak","from":"06:00","to":"10:00","rs_per_kwh":0.45},'
            '{"name":"night_rebate","from":"22:00","to":"06:00","rs_per_kwh":-0.40}]'
        )
    )
    notes: str = ""


class FlexLoadCreate(BaseModel):
    name: str
    power_kw: float
    run_hours: float
    earliest_start: str = "00:00"
    latest_finish: str = "23:59"
    can_pause: bool = False
    min_gap_hours: float = 0.0
    must_follow_load_id: int | None = None
    mode: str = Field("advisory", pattern="^(advisory|approve_to_run|automated)$")
    notes: str = ""


class AdvisorMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=4000)


class AdvisorRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000, description="Question for the GridSync AI advisor")
    plant_id: int | None = Field(None, description="Plant context (optional)")
    session_id: str | None = Field(None, max_length=64)
    history: list[AdvisorMessage] = Field(default_factory=list, max_length=10)
