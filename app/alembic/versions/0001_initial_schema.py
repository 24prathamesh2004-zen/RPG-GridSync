"""GridSync initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-15

NOTE: For development with SQLite, tables are created automatically via
create_all_tables() in db/base.py. Run Alembic only when migrating from an
existing schema.

Regenerate for your own changes with:
    alembic revision --autogenerate -m "your change"
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "companies",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(128), nullable=False, unique=True),
        sa.Column("short_name", sa.String(32), nullable=False),
        sa.Column("sector", sa.String(64), default="Industrial"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "plants",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("company_id", sa.Integer, sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("state", sa.String(64), nullable=False),
        sa.Column("utility", sa.String(64), default=""),
        sa.Column("archetype", sa.String(4), default="A"),
        sa.Column("latitude", sa.Float, nullable=True),
        sa.Column("longitude", sa.Float, nullable=True),
        sa.Column("contract_demand_kva", sa.Float, default=0.0),
        sa.Column("tariff_category", sa.String(32), default="HT-Industrial"),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column("notes", sa.Text, default=""),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "power_sources",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("plant_id", sa.Integer, sa.ForeignKey("plants.id"), nullable=False),
        sa.Column("source_type", sa.String(32), nullable=False),
        sa.Column("capacity_kw", sa.Float, default=0.0),
        sa.Column("matching_rule", sa.String(32), default=""),
        sa.Column("notes", sa.Text, default=""),
    )

    op.create_table(
        "tariff_schedules",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("plant_id", sa.Integer, sa.ForeignKey("plants.id"), nullable=False),
        sa.Column("effective_from", sa.String(10), nullable=False),
        sa.Column("base_rs_per_kwh", sa.Float, default=4.30),
        sa.Column("demand_charge_rs_per_kva", sa.Float, default=0.0),
        sa.Column("slots", sa.JSON, default=list),
        sa.Column("notes", sa.Text, default=""),
    )

    op.create_table(
        "flex_loads",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("plant_id", sa.Integer, sa.ForeignKey("plants.id"), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("power_kw", sa.Float, nullable=False),
        sa.Column("run_hours", sa.Float, nullable=False),
        sa.Column("earliest_start", sa.String(5), default="00:00"),
        sa.Column("latest_finish", sa.String(5), default="23:59"),
        sa.Column("can_pause", sa.Boolean, default=False),
        sa.Column("min_gap_hours", sa.Float, default=0.0),
        sa.Column("must_follow_load_id", sa.Integer, sa.ForeignKey("flex_loads.id"), nullable=True),
        sa.Column("mode", sa.String(32), default="advisory"),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column("notes", sa.Text, default=""),
    )

    op.create_table(
        "observations",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("data_point_id", sa.String(32), nullable=False, index=True),
        sa.Column("entity", sa.String(64), nullable=False, index=True),
        sa.Column("block_start_ist", sa.String(20), nullable=False, index=True),
        sa.Column("value", sa.Float, nullable=True),
        sa.Column("unit", sa.String(32), default=""),
        sa.Column("status", sa.String(16), default="fresh"),
        sa.Column("source", sa.String(64), default=""),
        sa.Column("raw_json", sa.JSON, nullable=True),
        sa.Column("received_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "meter_readings",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("plant_id", sa.Integer, sa.ForeignKey("plants.id"), nullable=False),
        sa.Column("block_start_ist", sa.String(20), nullable=False),
        sa.Column("kwh", sa.Float, default=0.0),
        sa.Column("kw_avg", sa.Float, default=0.0),
        sa.Column("kvah", sa.Float, nullable=True),
        sa.Column("power_factor", sa.Float, nullable=True),
        sa.Column("status", sa.String(16), default="fresh"),
    )

    op.create_table(
        "signals",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("plant_id", sa.Integer, sa.ForeignKey("plants.id"), nullable=False),
        sa.Column("block_start_ist", sa.String(20), nullable=False, index=True),
        sa.Column("price_rs_per_kwh", sa.Float, default=0.0),
        sa.Column("carbon_kg_per_kwh", sa.Float, default=0.0),
        sa.Column("captive_availability", sa.Float, default=0.0),
        sa.Column("window_score", sa.Float, default=0.0),
        sa.Column("tod_slot", sa.String(32), default="off_peak"),
        sa.Column("computed_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "recommendations",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("load_id", sa.Integer, sa.ForeignKey("flex_loads.id"), nullable=False),
        sa.Column("recommended_date", sa.String(10), nullable=False),
        sa.Column("recommended_start", sa.String(20), nullable=False),
        sa.Column("recommended_end", sa.String(20), nullable=False),
        sa.Column("reason", sa.Text, default=""),
        sa.Column("estimated_saving_rs", sa.Float, default=0.0),
        sa.Column("estimated_carbon_saving_kg", sa.Float, default=0.0),
        sa.Column("confidence", sa.String(16), default="medium"),
        sa.Column("status", sa.String(32), default="pending"),
        sa.Column("agent_explanation", sa.Text, default=""),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "execution_events",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("recommendation_id", sa.Integer, sa.ForeignKey("recommendations.id"), nullable=False),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("actor", sa.String(64), default="system"),
        sa.Column("reason", sa.Text, default=""),
        sa.Column("occurred_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "ledger_entries",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("plant_id", sa.Integer, sa.ForeignKey("plants.id"), nullable=False),
        sa.Column("period_start", sa.String(10), nullable=False),
        sa.Column("period_end", sa.String(10), nullable=False),
        sa.Column("baseline_cost_rs", sa.Float, default=0.0),
        sa.Column("actual_cost_rs", sa.Float, default=0.0),
        sa.Column("avoided_cost_rs", sa.Float, default=0.0),
        sa.Column("baseline_co2_kg", sa.Float, default=0.0),
        sa.Column("actual_co2_kg", sa.Float, default=0.0),
        sa.Column("avoided_co2_kg", sa.Float, default=0.0),
        sa.Column("runs", sa.Integer, default=0),
        sa.Column("method", sa.String(64), default="meter_vs_baseline"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )


def downgrade() -> None:
    for table in [
        "ledger_entries", "execution_events", "recommendations", "signals",
        "meter_readings", "observations", "flex_loads", "tariff_schedules",
        "power_sources", "plants", "companies",
    ]:
        op.drop_table(table)
