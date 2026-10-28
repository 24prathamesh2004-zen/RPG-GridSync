"""RPG GridSync — FastAPI application entry point.

Shifts energy-intensive industrial loads to cheaper, cleaner grid windows.
"""
from __future__ import annotations

import truststore

truststore.inject_into_ssl()

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import agent, health, impact, plants, recommendations, signals
from db.base import create_all_tables
from shared.config import get_settings
from shared.logger import get_logger, setup_logging
from services.daily_recommendation_scheduler import daily_recommendation_loop

log = get_logger("api.main")
settings = get_settings()

APP_VERSION = "1.0.0"


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    # SQLite: create tables on first run (no Alembic needed for dev)
    await create_all_tables()
    log.info("gridsync.startup", env=settings.app_env, version=APP_VERSION)
    # Seed demo data on first run if DB is empty
    await _seed_demo_data()
    scheduler_task = None
    if settings.daily_recommendation_enabled:
        scheduler_task = asyncio.create_task(daily_recommendation_loop())
        log.info(
            "daily_recommendation_scheduler_started time=%s IST",
            settings.daily_recommendation_time,
        )
    try:
        yield
    finally:
        if scheduler_task:
            scheduler_task.cancel()
            try:
                await scheduler_task
            except asyncio.CancelledError:
                pass
        log.info("gridsync.shutdown")


async def _seed_demo_data() -> None:
    """Seed RPG plant register (D16) with real public data on first startup.

    Only seeds:
    - Companies (from public filings)
    - Plants with real lat/lon, states, utilities, archetypes (from planning docs)
    - Power sources (from public BRSR / press releases)
    - Tariff schedules (from GERC/MERC/TNERC regulator orders)
    - Flex load templates (process names and typical kW from industry knowledge)

    Nothing seeded: no fake recommendations, no fake ledger entries,
    no random savings numbers, no simulated history. All zero until
    real plant engineers add loads and generate real recommendations.
    """
    from db.base import AsyncSessionLocal
    from db.models import Company, FlexLoad, Plant, PowerSource, TariffSchedule
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        count = await db.execute(select(Company))
        if count.scalars().first():
            return  # already seeded

        log.info("seeding plant register from public data (no mock history)")

        # ── Companies ──────────────────────────────────────────────────────────
        ceat = Company(name="CEAT Ltd", short_name="CEAT", sector="Tyres")
        kec = Company(name="KEC International Ltd", short_name="KEC", sector="Power T&D")
        db.add_all([ceat, kec])
        await db.flush()

        # ── Plants ─────────────────────────────────────────────────────────────
        plants_data = [
            dict(company_id=ceat.id, name="CEAT Halol", state="Gujarat",
                 utility="MGVCL", archetype="C", latitude=22.50, longitude=73.47,
                 contract_demand_kva=5000.0, tariff_category="HT-Industrial",
                 notes="59MW wind-solar hybrid CleanMax captive (Jan 2026)"),
            dict(company_id=ceat.id, name="CEAT Kanchipuram", state="Tamil Nadu",
                 utility="TANGEDCO", archetype="C", latitude=12.83, longitude=79.70,
                 contract_demand_kva=4500.0, tariff_category="HT-Industrial",
                 notes="5MW rooftop solar + CleanMax hybrid captive"),
            dict(company_id=ceat.id, name="CEAT Nashik", state="Maharashtra",
                 utility="MSEDCL", archetype="C", latitude=20.00, longitude=73.78,
                 contract_demand_kva=3500.0, tariff_category="HT-Industrial",
                 notes="5MW captive wind (Cleanwin) + rooftop solar"),
            dict(company_id=ceat.id, name="CEAT Bhandup", state="Maharashtra",
                 utility="MSEDCL", archetype="C", latitude=19.16, longitude=72.94,
                 contract_demand_kva=3000.0, tariff_category="HT-Industrial",
                 notes="5MW captive wind (Cleanwin) + rooftop solar"),
            dict(company_id=ceat.id, name="CEAT Nagpur", state="Maharashtra",
                 utility="MSEDCL", archetype="A", latitude=21.14, longitude=79.08,
                 contract_demand_kva=2000.0, tariff_category="HT-Industrial"),
            dict(company_id=kec.id, name="KEC Vadodara", state="Gujarat",
                 utility="MGVCL", archetype="B", latitude=22.31, longitude=73.19,
                 contract_demand_kva=4000.0, tariff_category="HT-Industrial",
                 notes="~70% renewable; rooftop solar + PPAs"),
            dict(company_id=kec.id, name="KEC Nagpur", state="Maharashtra",
                 utility="MSEDCL", archetype="B", latitude=21.14, longitude=79.08,
                 contract_demand_kva=3000.0, tariff_category="HT-Industrial",
                 notes="Captive solar; zinc recovery furnace loads"),
            dict(company_id=kec.id, name="KEC Jaipur", state="Rajasthan",
                 utility="JVVNL", archetype="B", latitude=26.91, longitude=75.79,
                 contract_demand_kva=2500.0, tariff_category="HT-Industrial",
                 notes="Rooftop solar"),
            dict(company_id=kec.id, name="KEC Mysore", state="Karnataka",
                 utility="CESC", archetype="B", latitude=12.29, longitude=76.64,
                 contract_demand_kva=3500.0, tariff_category="HT-Industrial",
                 notes="~96% renewable energy"),
        ]

        plant_objs = []
        for pd in plants_data:
            p = Plant(**pd)
            db.add(p)
            plant_objs.append(p)
        await db.flush()

        # ── Gujarat ToD tariff (all Gujarat plants) ────────────────────────────
        gujarat_slots = [
            {"name": "peak",         "from": "06:00", "to": "10:00", "rs_per_kwh":  0.45},
            {"name": "peak",         "from": "18:00", "to": "22:00", "rs_per_kwh":  0.45},
            {"name": "night_rebate", "from": "22:00", "to": "06:00", "rs_per_kwh": -0.40},
            {"name": "solar_rebate", "from": "10:00", "to": "16:00", "rs_per_kwh": -0.10},
        ]
        maharashtra_slots = [
            {"name": "peak",         "from": "06:00", "to": "09:00", "rs_per_kwh":  0.30},
            {"name": "peak",         "from": "18:00", "to": "22:00", "rs_per_kwh":  0.30},
            {"name": "solar_rebate", "from": "09:00", "to": "15:00", "rs_per_kwh": -0.15},
            {"name": "night_rebate", "from": "22:00", "to": "06:00", "rs_per_kwh": -0.25},
        ]
        state_tariffs = {
            "Gujarat":     (4.30, gujarat_slots),
            "Maharashtra": (4.10, maharashtra_slots),
            "Tamil Nadu":  (4.50, [
                {"name": "peak",         "from": "06:00", "to": "09:00", "rs_per_kwh":  0.40},
                {"name": "peak",         "from": "18:00", "to": "21:00", "rs_per_kwh":  0.40},
                {"name": "night_rebate", "from": "22:00", "to": "05:00", "rs_per_kwh": -0.30},
            ]),
            "Rajasthan":   (4.20, [
                {"name": "peak",         "from": "07:00", "to": "11:00", "rs_per_kwh":  0.35},
                {"name": "peak",         "from": "17:00", "to": "21:00", "rs_per_kwh":  0.35},
                {"name": "solar_rebate", "from": "11:00", "to": "15:00", "rs_per_kwh": -0.20},
            ]),
            "Karnataka":   (4.40, [
                {"name": "peak",         "from": "06:00", "to": "10:00", "rs_per_kwh":  0.40},
                {"name": "peak",         "from": "18:00", "to": "22:00", "rs_per_kwh":  0.40},
                {"name": "solar_rebate", "from": "10:00", "to": "16:00", "rs_per_kwh": -0.15},
            ]),
        }
        for p in plant_objs:
            base, slots = state_tariffs.get(p.state, (4.30, gujarat_slots))
            db.add(TariffSchedule(
                plant_id=p.id,
                effective_from="2026-04-01",
                base_rs_per_kwh=base,
                slots=slots,
                notes=f"{p.state} HT-Industrial ToD FY2026-27",
            ))

        # ── Power sources ──────────────────────────────────────────────────────
        source_map = {
            "CEAT Halol":       [("utility", 0), ("captive_hybrid", 59000)],
            "CEAT Kanchipuram": [("utility", 0), ("rooftop_solar", 5000), ("captive_solar", 10000)],
            "CEAT Nashik":      [("utility", 0), ("captive_wind", 5000), ("rooftop_solar", 500)],
            "CEAT Bhandup":     [("utility", 0), ("captive_wind", 5000), ("rooftop_solar", 300)],
            "CEAT Nagpur":      [("utility", 0)],
            "KEC Vadodara":     [("utility", 0), ("rooftop_solar", 2000), ("ppa", 5000)],
            "KEC Nagpur":       [("utility", 0), ("rooftop_solar", 1500)],
            "KEC Jaipur":       [("utility", 0), ("rooftop_solar", 800)],
            "KEC Mysore":       [("utility", 0), ("ppa", 8000)],
        }
        for p in plant_objs:
            for stype, cap in source_map.get(p.name, [("utility", 0)]):
                db.add(PowerSource(plant_id=p.id, source_type=stype, capacity_kw=cap))

        # ── Flex loads per plant ───────────────────────────────────────────────
        flex_load_templates = {
            "CEAT Halol": [
                dict(name="Tyre Curing Presses (Bank A)", power_kw=850, run_hours=4.0,
                     earliest_start="00:00", latest_finish="23:59", can_pause=False, mode="advisory"),
                dict(name="Rubber Mixing (Banbury)", power_kw=620, run_hours=3.0,
                     earliest_start="06:00", latest_finish="22:00", can_pause=True, mode="advisory"),
                dict(name="Cooling Tower Pumps", power_kw=180, run_hours=6.0,
                     earliest_start="00:00", latest_finish="23:59", can_pause=True, mode="advisory"),
                dict(name="Compressed Air System", power_kw=240, run_hours=8.0,
                     earliest_start="06:00", latest_finish="20:00", can_pause=False, mode="advisory"),
            ],
            "CEAT Kanchipuram": [
                dict(name="Tyre Curing Presses (Bank B)", power_kw=720, run_hours=4.0,
                     earliest_start="00:00", latest_finish="23:59", can_pause=False, mode="advisory"),
                dict(name="Bead Wire Drawing", power_kw=380, run_hours=5.0,
                     earliest_start="08:00", latest_finish="22:00", can_pause=True, mode="advisory"),
            ],
            "CEAT Nashik": [
                dict(name="Curing Batch (Truck Tyres)", power_kw=550, run_hours=3.5,
                     earliest_start="00:00", latest_finish="23:59", mode="advisory"),
                dict(name="Calender Line", power_kw=290, run_hours=4.0,
                     earliest_start="07:00", latest_finish="20:00", mode="advisory"),
            ],
            "KEC Vadodara": [
                dict(name="Cable Extrusion Line", power_kw=920, run_hours=6.0,
                     earliest_start="00:00", latest_finish="23:59", can_pause=False, mode="advisory"),
                dict(name="Aluminium Rod Breakdown", power_kw=680, run_hours=4.0,
                     earliest_start="06:00", latest_finish="22:00", can_pause=True, mode="advisory"),
                dict(name="Annealing Furnace", power_kw=420, run_hours=3.0,
                     earliest_start="10:00", latest_finish="22:00", can_pause=False, mode="advisory"),
            ],
            "KEC Nagpur": [
                dict(name="Galvanizing Zinc Bath", power_kw=750, run_hours=5.0,
                     earliest_start="00:00", latest_finish="23:59", can_pause=False, mode="advisory"),
                dict(name="Induction Furnace (Tower Sections)", power_kw=880, run_hours=3.5,
                     earliest_start="06:00", latest_finish="22:00", can_pause=False, mode="advisory"),
            ],
            "KEC Jaipur": [
                dict(name="Galvanizing Line", power_kw=560, run_hours=4.0,
                     earliest_start="00:00", latest_finish="23:59", mode="advisory"),
                dict(name="Shot Blasting (Structure)", power_kw=220, run_hours=3.0,
                     earliest_start="08:00", latest_finish="18:00", mode="advisory"),
            ],
            "KEC Mysore": [
                dict(name="Cable Stranding Machine", power_kw=480, run_hours=5.0,
                     earliest_start="00:00", latest_finish="23:59", mode="advisory"),
            ],
        }

        # Default loads for plants without specific templates
        default_loads = [
            dict(name="Main Process Load", power_kw=400, run_hours=4.0,
                 earliest_start="00:00", latest_finish="23:59", mode="advisory"),
        ]

        load_objs: dict[int, list[FlexLoad]] = {}  # plant_id -> list of loads
        for p in plant_objs:
            templates = flex_load_templates.get(p.name, default_loads)
            load_objs[p.id] = []
            for t in templates:
                fl = FlexLoad(plant_id=p.id, **t)
                db.add(fl)
                load_objs[p.id].append(fl)

        await db.flush()

        await db.commit()
        log.info("seed_complete plants=%d — zero fake history, ready for real data", len(plant_objs))


app = FastAPI(
    title="RPG GridSync API",
    description=(
        "Intelligent load scheduling — shifts flexible industrial loads to "
        "cheaper, cleaner grid windows to cut costs and improve ESG scores."
    ),
    version=APP_VERSION,
    lifespan=lifespan,
)

# ── CORS ───────────────────────────────────────────────────────────────────────
if settings.app_env == "development":
    _cors_origins = ["http://localhost:3000", "http://localhost:5173", "http://localhost:5174"]
else:
    _cors_origins = [o.strip() for o in settings.cors_allowed_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins if _cors_origins else ["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)

# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(health.router, tags=["Health"])
app.include_router(plants.router, prefix="/api/v1")
app.include_router(signals.router, prefix="/api/v1")
app.include_router(recommendations.router, prefix="/api/v1")
app.include_router(agent.router, prefix="/api/v1")
app.include_router(impact.router, prefix="/api/v1")
