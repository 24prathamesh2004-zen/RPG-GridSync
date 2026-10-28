"""GridSync ORM models.

Hierarchy:
  Group → Company → Plant → PowerSource
                    Plant → TariffSchedule (slots, effective_from)
                    Plant → FlexLoad → LoadRule
                    Plant → MeterReading (15-min)
  Observation      (raw ingest: price, carbon, weather, grid)
  Signal           (computed per plant per 15-min block)
  Recommendation   (optimiser output per load)
  ExecutionEvent   (approved | rejected | completed | overridden)
  LedgerEntry      (actual vs baseline savings)
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


# ── Reference / Configuration models ──────────────────────────────────────────

class Company(Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    short_name: Mapped[str] = mapped_column(String(32), nullable=False)
    sector: Mapped[str] = mapped_column(String(64), default="Industrial")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    plants: Mapped[list["Plant"]] = relationship("Plant", back_populates="company")


class Plant(Base):
    __tablename__ = "plants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    state: Mapped[str] = mapped_column(String(64), nullable=False)
    # State distribution company e.g. MGVCL, MSEDCL, TNERC
    utility: Mapped[str] = mapped_column(String(64), default="")
    # A=utility only, B=utility+rooftop, C=utility+captive/open-access
    archetype: Mapped[str] = mapped_column(String(4), default="A")
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    # kVA contract demand
    contract_demand_kva: Mapped[float] = mapped_column(Float, default=0.0)
    tariff_category: Mapped[str] = mapped_column(String(32), default="HT-Industrial")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    company: Mapped["Company"] = relationship("Company", back_populates="plants")
    power_sources: Mapped[list["PowerSource"]] = relationship("PowerSource", back_populates="plant")
    tariff_schedules: Mapped[list["TariffSchedule"]] = relationship("TariffSchedule", back_populates="plant")
    flex_loads: Mapped[list["FlexLoad"]] = relationship("FlexLoad", back_populates="plant")
    meter_readings: Mapped[list["MeterReading"]] = relationship("MeterReading", back_populates="plant")
    signals: Mapped[list["Signal"]] = relationship("Signal", back_populates="plant")


class PowerSource(Base):
    __tablename__ = "power_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plants.id"), nullable=False)
    # utility | rooftop_solar | captive_wind | captive_solar | captive_hybrid | open_access | ppa
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    capacity_kw: Mapped[float] = mapped_column(Float, default=0.0)
    # For captive/open-access: matching rule (15min | monthly | annual)
    matching_rule: Mapped[str] = mapped_column(String(32), default="")
    notes: Mapped[str] = mapped_column(Text, default="")

    plant: Mapped["Plant"] = relationship("Plant", back_populates="power_sources")


class TariffSchedule(Base):
    """Time-of-day tariff configuration — stored as JSON slots.

    slots format: [{"name": "peak", "from": "06:00", "to": "10:00",
                    "rs_per_kwh": 5.15, "adjustment_pct": 10.0}]
    """
    __tablename__ = "tariff_schedules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plants.id"), nullable=False)
    effective_from: Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD
    base_rs_per_kwh: Mapped[float] = mapped_column(Float, default=4.30)
    demand_charge_rs_per_kva: Mapped[float] = mapped_column(Float, default=0.0)
    slots: Mapped[dict] = mapped_column(JSON, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")

    plant: Mapped["Plant"] = relationship("Plant", back_populates="tariff_schedules")


class FlexLoad(Base):
    """A flexible, non-time-critical energy load at a plant.

    e.g. curing cycle, batch mixer, galvanizing furnace, cooling tower.
    """
    __tablename__ = "flex_loads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plants.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    power_kw: Mapped[float] = mapped_column(Float, nullable=False)
    # Run duration in hours
    run_hours: Mapped[float] = mapped_column(Float, nullable=False)
    # Earliest start and latest finish (HH:MM, 24h)
    earliest_start: Mapped[str] = mapped_column(String(5), default="00:00")
    latest_finish: Mapped[str] = mapped_column(String(5), default="23:59")
    can_pause: Mapped[bool] = mapped_column(Boolean, default=False)
    min_gap_hours: Mapped[float] = mapped_column(Float, default=0.0)
    # ID of another load this must follow (nullable)
    must_follow_load_id: Mapped[int | None] = mapped_column(ForeignKey("flex_loads.id"), nullable=True)
    # advisory | approve_to_run | automated
    mode: Mapped[str] = mapped_column(String(32), default="advisory")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str] = mapped_column(Text, default="")

    plant: Mapped["Plant"] = relationship("Plant", back_populates="flex_loads")
    recommendations: Mapped[list["Recommendation"]] = relationship("Recommendation", back_populates="load")


# ── Time-series Observation ────────────────────────────────────────────────────

class Observation(Base):
    """Raw ingest record from any external source (D1-D16).

    data_point_id: D1=iex_dam, D2=iex_rtm, D4=grid_generation,
                   D6=emission_factor, D7=weather, D13=sldc_state
    entity: plant_id (str) or state code e.g. "GJ", "MH"
    status: fresh | late | estimated | suspect | missing
    """
    __tablename__ = "observations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    data_point_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    entity: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    block_start_ist: Mapped[str] = mapped_column(String(20), nullable=False, index=True)  # ISO datetime
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str] = mapped_column(String(32), default="")
    status: Mapped[str] = mapped_column(String(16), default="fresh")
    source: Mapped[str] = mapped_column(String(64), default="")
    raw_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class MeterReading(Base):
    """15-minute plant meter data (D8)."""
    __tablename__ = "meter_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plants.id"), nullable=False)
    block_start_ist: Mapped[str] = mapped_column(String(20), nullable=False)
    kwh: Mapped[float] = mapped_column(Float, default=0.0)
    kw_avg: Mapped[float] = mapped_column(Float, default=0.0)
    kvah: Mapped[float | None] = mapped_column(Float, nullable=True)
    power_factor: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="fresh")

    plant: Mapped["Plant"] = relationship("Plant", back_populates="meter_readings")


# ── Computed Signals ───────────────────────────────────────────────────────────

class Signal(Base):
    """Computed grid signal per plant per 15-min block.

    Inputs: tariff (D15), IEX price (D1/D2), CEA emission factor (D6),
    weather (D7), SLDC state (D13).
    """
    __tablename__ = "signals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plants.id"), nullable=False)
    block_start_ist: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    # Price signal in ₹/kWh
    price_rs_per_kwh: Mapped[float] = mapped_column(Float, default=0.0)
    # Carbon index in kgCO2/kWh (modelled)
    carbon_kg_per_kwh: Mapped[float] = mapped_column(Float, default=0.0)
    # Captive availability 0–1 (proxy from solar/wind forecast)
    captive_availability: Mapped[float] = mapped_column(Float, default=0.0)
    # Composite window score: lower is better
    window_score: Mapped[float] = mapped_column(Float, default=0.0)
    # tod_slot: peak | off_peak | solar_rebate | night_rebate
    tod_slot: Mapped[str] = mapped_column(String(32), default="off_peak")
    computed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    plant: Mapped["Plant"] = relationship("Plant", back_populates="signals")


# ── Recommendations ────────────────────────────────────────────────────────────

class Recommendation(Base):
    """Optimiser-produced scheduling recommendation for one flex load."""
    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    load_id: Mapped[int] = mapped_column(ForeignKey("flex_loads.id"), nullable=False)
    recommended_date: Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD
    recommended_start: Mapped[str] = mapped_column(String(20), nullable=False)  # ISO datetime
    recommended_end: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str] = mapped_column(Text, default="")
    # Estimated saving vs. original schedule in ₹
    estimated_saving_rs: Mapped[float] = mapped_column(Float, default=0.0)
    # Estimated carbon saving in kgCO2
    estimated_carbon_saving_kg: Mapped[float] = mapped_column(Float, default=0.0)
    # confidence: high | medium | low
    confidence: Mapped[str] = mapped_column(String(16), default="medium")
    # pending | approved | rejected | completed | overridden
    status: Mapped[str] = mapped_column(String(32), default="pending")
    agent_explanation: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    load: Mapped["FlexLoad"] = relationship("FlexLoad", back_populates="recommendations")
    events: Mapped[list["ExecutionEvent"]] = relationship("ExecutionEvent", back_populates="recommendation")


class ExecutionEvent(Base):
    """Audit trail for each recommendation lifecycle event."""
    __tablename__ = "execution_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    recommendation_id: Mapped[int] = mapped_column(ForeignKey("recommendations.id"), nullable=False)
    # recommended | approved | rejected | started | completed | overridden
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    actor: Mapped[str] = mapped_column(String(64), default="system")
    reason: Mapped[str] = mapped_column(Text, default="")
    occurred_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    recommendation: Mapped["Recommendation"] = relationship("Recommendation", back_populates="events")


class LedgerEntry(Base):
    """Verified savings and carbon per plant per period."""
    __tablename__ = "ledger_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plants.id"), nullable=False)
    period_start: Mapped[str] = mapped_column(String(10), nullable=False)
    period_end: Mapped[str] = mapped_column(String(10), nullable=False)
    baseline_cost_rs: Mapped[float] = mapped_column(Float, default=0.0)
    actual_cost_rs: Mapped[float] = mapped_column(Float, default=0.0)
    avoided_cost_rs: Mapped[float] = mapped_column(Float, default=0.0)
    baseline_co2_kg: Mapped[float] = mapped_column(Float, default=0.0)
    actual_co2_kg: Mapped[float] = mapped_column(Float, default=0.0)
    avoided_co2_kg: Mapped[float] = mapped_column(Float, default=0.0)
    # number of recommendations executed
    runs: Mapped[int] = mapped_column(Integer, default=0)
    method: Mapped[str] = mapped_column(String(64), default="meter_vs_baseline")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
