"""GridSync Optimizer — schedules flexible loads into optimal windows.

No ML. Rule-based greedy optimizer:
  1. Sort loads by power_kw × run_hours (largest energy first)
  2. For each load, find the lowest window_score continuous slot
     that satisfies all constraints (earliest/latest, gaps, order, demand)
  3. Build daily recommendations

This is Phase 1 (advisory). It produces recommendations with reasons,
carbon and cost estimates. No control of any machine.

For production, consider OR-Tools CP-SAT for exact optimization with
hard constraints. This greedy approach is fast and explainable.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any

from services.signal_engine import compute_signals_for_plant, best_windows

log = logging.getLogger("services.optimizer")


def _kwh_cost(price_rs_per_kwh: float, power_kw: float, duration_h: float) -> float:
    return price_rs_per_kwh * power_kw * duration_h


def _carbon_kg(carbon_kg_per_kwh: float, power_kw: float, duration_h: float) -> float:
    return carbon_kg_per_kwh * power_kw * duration_h


async def generate_recommendations(
    plant: dict[str, Any],
    flex_loads: list[dict[str, Any]],
    for_date: date | None = None,
) -> list[dict[str, Any]]:
    """Generate daily recommendations for all flex loads at a plant.

    plant dict: {id, state, archetype, latitude, longitude,
                 base_tariff_rs_per_kwh, tariff_slots, contract_demand_kva, name}

    flex_load dict: {id, name, power_kw, run_hours, earliest_start,
                     latest_finish, can_pause, min_gap_hours, must_follow_load_id,
                     mode, is_active}

    Returns list of recommendation dicts.
    """
    target = for_date or date.today()

    signals = await compute_signals_for_plant(
        plant_id=plant["id"],
        state=plant["state"],
        archetype=plant.get("archetype", "A"),
        latitude=plant.get("latitude"),
        longitude=plant.get("longitude"),
        base_tariff_rs_per_kwh=plant.get("base_tariff_rs_per_kwh", 4.30),
        tariff_slots=plant.get("tariff_slots", []),
        for_date=target,
    )

    active_loads = [l for l in flex_loads if l.get("is_active", True)]
    # Sort: largest energy draw first (most impactful to shift)
    active_loads.sort(key=lambda l: l["power_kw"] * l["run_hours"], reverse=True)

    # Build a schedule map: block_start_ist -> reserved_kw (for demand tracking)
    schedule_map: dict[str, float] = {}
    contract_demand_kva = plant.get("contract_demand_kva", 9999.0)
    assumed_pf = 0.90
    contract_demand_kw = contract_demand_kva * assumed_pf

    # Track placed loads for ordering constraints
    placed: dict[int, str] = {}  # load_id -> placed_start block key

    recommendations = []

    for load in active_loads:
        load_id = load["id"]
        power_kw = load["power_kw"]
        run_hours = load["run_hours"]
        earliest = load.get("earliest_start", "00:00")
        latest = load.get("latest_finish", "23:59")
        min_gap_h = load.get("min_gap_hours", 0.0)
        must_follow_id = load.get("must_follow_load_id")
        blocks_needed = max(1, int(run_hours * 4))

        # Determine earliest start based on must_follow constraint
        effective_earliest = earliest
        if must_follow_id and must_follow_id in placed:
            # Must start after the followed load finishes + gap
            prev_start = placed[must_follow_id]
            prev_load = next((l for l in active_loads if l["id"] == must_follow_id), None)
            if prev_load:
                prev_blocks = max(1, int(prev_load["run_hours"] * 4))
                try:
                    prev_dt = datetime.fromisoformat(prev_start)
                    earliest_dt = prev_dt + timedelta(minutes=prev_blocks * 15) + timedelta(hours=min_gap_h)
                    effective_earliest = earliest_dt.strftime("%H:%M")
                except Exception:
                    pass

        # Find candidate windows (allow for demand constraint)
        windows = best_windows(signals, run_hours, effective_earliest, latest)

        if not windows:
            log.warning("no_windows load_id=%s load=%s", load_id, load["name"])
            continue

        # Pick the best window that does not exceed contract demand
        chosen = None
        for w in windows:
            # Check demand headroom for each block in window
            w_start_str = w["start"]
            fits = True
            for b in range(blocks_needed):
                try:
                    b_dt = datetime.fromisoformat(w_start_str) + timedelta(minutes=b * 15)
                    b_key = b_dt.strftime("%Y-%m-%dT%H:%M")
                    current_kw = schedule_map.get(b_key, 0.0)
                    if contract_demand_kw > 0 and current_kw + power_kw > contract_demand_kw * 1.05:
                        fits = False
                        break
                except Exception:
                    pass
            if fits:
                chosen = w
                break

        if not chosen:
            chosen = windows[0]  # use best even if demand might be tight

        # Compute original cost (assume load ran at a typical peak time = worst window)
        worst_window = max(windows, key=lambda x: x["avg_price_rs_per_kwh"])
        original_cost = _kwh_cost(worst_window["avg_price_rs_per_kwh"], power_kw, run_hours)
        actual_cost = _kwh_cost(chosen["avg_price_rs_per_kwh"], power_kw, run_hours)
        saving_rs = max(0.0, original_cost - actual_cost)

        original_carbon = _carbon_kg(
            max(s["carbon_kg_per_kwh"] for s in signals), power_kw, run_hours
        )
        actual_carbon = _carbon_kg(chosen["avg_carbon_kg_per_kwh"], power_kw, run_hours)
        carbon_saving_kg = max(0.0, original_carbon - actual_carbon)

        # Confidence: high if IEX data (fresh), medium if fallback/estimated
        price_status = next(
            (s for s in signals if s["block_start_ist"] == chosen["start"]), {}
        )
        if price_status.get("price_status") != "fresh":
            confidence = "low"
        elif str(price_status.get("price_source", "")).startswith("iex_"):
            confidence = "high"
        else:
            confidence = "medium"

        # Reason text
        slot_label = chosen.get("tod_slot", "") or signals[
            next((i for i, s in enumerate(signals) if s["block_start_ist"] == chosen["start"]), 0)
        ].get("tod_slot", "")
        reason = _build_reason(
            load["name"],
            chosen,
            saving_rs,
            carbon_saving_kg,
            slot_label,
            plant.get("archetype", "A"),
        )

        # Mark blocks as reserved
        for b in range(blocks_needed):
            try:
                b_dt = datetime.fromisoformat(chosen["start"]) + timedelta(minutes=b * 15)
                b_key = b_dt.strftime("%Y-%m-%dT%H:%M")
                schedule_map[b_key] = schedule_map.get(b_key, 0.0) + power_kw
            except Exception:
                pass

        placed[load_id] = chosen["start"]

        # Compute end time
        try:
            end_dt = datetime.fromisoformat(chosen["start"]) + timedelta(hours=run_hours)
            end_str = end_dt.strftime("%Y-%m-%dT%H:%M")
        except Exception:
            end_str = chosen["end"]

        recommendations.append({
            "load_id": load_id,
            "load_name": load["name"],
            "plant_name": plant.get("name", ""),
            "recommended_date": target.isoformat(),
            "recommended_start": chosen["start"],
            "recommended_end": end_str,
            "reason": reason,
            "estimated_saving_rs": round(saving_rs, 2),
            "estimated_carbon_saving_kg": round(carbon_saving_kg, 3),
            "confidence": confidence,
            "status": "pending",
            "avg_price_rs_per_kwh": chosen["avg_price_rs_per_kwh"],
            "avg_carbon_kg_per_kwh": chosen["avg_carbon_kg_per_kwh"],
            "saving_vs_worst_pct": chosen.get("saving_vs_worst_pct", 0.0),
        })

    return recommendations


def _build_reason(
    load_name: str,
    window: dict,
    saving_rs: float,
    carbon_saving_kg: float,
    slot: str,
    archetype: str,
) -> str:
    parts = [
        f"Run '{load_name}' at {window['start'][11:16]} IST.",
        f"Price ₹{window['avg_price_rs_per_kwh']:.2f}/kWh",
        f"(saves ₹{saving_rs:.0f} vs. original schedule).",
    ]
    if carbon_saving_kg > 0:
        parts.append(f"Avoids {carbon_saving_kg:.1f} kgCO₂.")
    slot_labels = {
        "solar_rebate": "Solar-hour rebate active.",
        "night_rebate": "Night rebate active — lowest tariff window.",
        "peak": "⚠ Peak surcharge applies — consider rescheduling.",
        "off_peak": "Off-peak period.",
    }
    if slot in slot_labels:
        parts.append(slot_labels[slot])
    if archetype == "C":
        captive = window.get("avg_carbon_kg_per_kwh", 1.0)
        if captive < 0.5:
            parts.append("Captive renewable generation likely high in this window.")
    return " ".join(parts)


def estimate_annual_value_per_kw(
    signals_history: list[list[dict[str, Any]]],
    run_hours: float = 4.0,
) -> dict[str, float]:
    """Estimate annual ₹ value per kW of flexible load from historical signals.

    Works on public data alone (D15 + D1/D2). Used for the 'value per kW'
    analysis shown in the Grid Signals Console (L1 output).

    signals_history: list of 96-block signal lists for each historical day.
    run_hours: typical load duration in hours.

    Returns: {"value_per_kw_per_year_rs": ..., "avg_daily_saving_rs_per_kw": ...}
    """
    daily_savings = []
    for day_signals in signals_history:
        if not day_signals:
            continue
        prices = [s["price_rs_per_kwh"] for s in day_signals]
        blocks = max(1, int(run_hours * 4))
        # Worst block average (original) vs best block average (optimised)
        if len(prices) < blocks:
            continue
        windows = [sum(prices[i:i + blocks]) / blocks for i in range(len(prices) - blocks + 1)]
        worst = max(windows)
        best = min(windows)
        daily_savings.append((worst - best) * run_hours)

    if not daily_savings:
        return {"value_per_kw_per_year_rs": 0.0, "avg_daily_saving_rs_per_kw": 0.0}

    avg_daily = sum(daily_savings) / len(daily_savings)
    annual = avg_daily * 365
    return {
        "value_per_kw_per_year_rs": round(annual, 2),
        "avg_daily_saving_rs_per_kw": round(avg_daily, 4),
    }
