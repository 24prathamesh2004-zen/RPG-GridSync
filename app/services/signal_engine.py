"""Signal Engine — computes per-plant, per-15-min window scores.

Inputs:
  - IEX DAM/RTM price (D1/D2) or ToD tariff (D15)
  - CEA emission factor shaped by solar hour (D6, D7)
  - Captive availability from weather forecast (D7, D13)

Output per block:
  price_rs_per_kwh, carbon_kg_per_kwh, captive_availability, window_score, tod_slot

Window score formula (lower = better window to run a load):
  score = w_price × norm_price + w_carbon × norm_carbon - w_captive × captive_availability

Where norm_price and norm_carbon are normalised 0–1 across the day's 96 blocks.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any

from ingestion.connectors.cea import get_hourly_carbon_index
from ingestion.connectors.iex import fetch_dam_prices, _flat_fallback
from ingestion.connectors.weather import (
    fetch_solar_wind_forecast,
    solar_availability_index,
    wind_availability_index,
)
from shared.config import get_settings
from shared.cache import get_cache

log = logging.getLogger("services.signal_engine")


def _tod_slot(hour: int) -> str:
    """Classify hour into ToD slot for Gujarat HT-Industrial tariff (GERC FY27).

    Peak: 06:00–10:00 and 18:00–22:00 (+45 paise surcharge)
    Solar rebate: 10:00–16:00 (solar hour, GERC trend)
    Night rebate: 22:00–06:00 (-40 paise rebate)
    """
    if 6 <= hour < 10 or 18 <= hour < 22:
        return "peak"
    if 10 <= hour < 16:
        return "solar_rebate"
    if hour >= 22 or hour < 6:
        return "night_rebate"
    return "off_peak"


async def compute_signals_for_plant(
    plant_id: int,
    state: str,
    archetype: str,
    latitude: float | None,
    longitude: float | None,
    base_tariff_rs_per_kwh: float = 4.30,
    tariff_slots: list[dict] | None = None,
    for_date: date | None = None,
) -> list[dict[str, Any]]:
    """Compute 96 × 15-min signals for a plant for a given date.

    Returns list of signal dicts ready for DB insert or API response.
    """
    settings = get_settings()
    target = for_date or date.today()
    cache = get_cache()
    cache_key = f"signals:{plant_id}:{target.isoformat()}"

    cached = await cache.get(cache_key)
    if cached:
        return cached

    # 1. Price blocks
    price_blocks = await fetch_dam_prices(target)
    price_by_block = {
        block["block_start_ist"]: block["price_rs_per_mwh"] / 1000.0
        for block in price_blocks
    }
    price_provenance = {
        block["block_start_ist"]: {
            "source": block.get("source", "unknown"),
            "status": block.get("status", "estimated"),
        }
        for block in price_blocks
    }

    # 2. Weather / solar (if we have coordinates)
    solar_by_hour: dict[str, float] = {}
    wind_by_hour: dict[str, float] = {}
    if latitude and longitude:
        weather = await fetch_solar_wind_forecast(latitude, longitude, target)
        for w in weather:
            hour_key = w["hour_ist"][:13]  # "2026-10-15T08"
            solar_by_hour[hour_key] = solar_availability_index(
                w["direct_radiation_wm2"], w["cloud_cover_pct"]
            )
            wind_by_hour[hour_key] = wind_availability_index(w["wind_speed_kmh"])

    # 3. Build per-block signals
    signals: list[dict[str, Any]] = []
    base_dt = datetime(target.year, target.month, target.day)

    for block in range(96):
        from datetime import timedelta
        block_dt = base_dt + timedelta(minutes=block * 15)
        block_key = block_dt.strftime("%Y-%m-%dT%H:%M")
        hour = block_dt.hour
        hour_key = block_dt.strftime("%Y-%m-%dT%H")

        # Price
        price = price_by_block.get(block_key, base_tariff_rs_per_kwh)
        provenance = price_provenance.get(
            block_key, {"source": "tariff_estimate", "status": "estimated"}
        )
        # Apply ToD slot adjustment
        slot = _tod_slot(hour)
        if tariff_slots:
            for s in tariff_slots:
                s_from = int(s.get("from", "00:00").replace(":", ""))
                s_to = int(s.get("to", "24:00").replace(":", ""))
                block_time = block_dt.hour * 100 + block_dt.minute
                if s_from <= block_time < s_to:
                    slot = s.get("name", slot)
                    adj = s.get("rs_per_kwh", 0.0)
                    price = price + adj
                    break
        # Carbon
        carbon = get_hourly_carbon_index(state, hour)

        # Captive availability
        captive = 0.0
        if archetype in ("B", "C"):
            solar = solar_by_hour.get(hour_key, 0.0)
            wind = wind_by_hour.get(hour_key, 0.0)
            if archetype == "B":
                captive = solar  # rooftop only
            else:
                # Captive hybrid: weighted average solar + wind
                captive = min(1.0, (solar * 0.6 + wind * 0.4))

        signals.append({
            "plant_id": plant_id,
            "block_start_ist": block_key,
            "price_rs_per_kwh": round(price, 4),
            "price_source": provenance["source"],
            "price_status": provenance["status"],
            "carbon_kg_per_kwh": carbon,
            "captive_availability": captive,
            "tod_slot": slot,
            # window_score computed after normalisation below
            "window_score": 0.0,
        })

    # 4. Normalise price and carbon 0–1, then compute window score
    prices = [s["price_rs_per_kwh"] for s in signals]
    carbons = [s["carbon_kg_per_kwh"] for s in signals]
    p_min, p_max = min(prices), max(prices)
    c_min, c_max = min(carbons), max(carbons)
    p_range = p_max - p_min or 1.0
    c_range = c_max - c_min or 1.0

    w_p = settings.gridsync_weight_price
    w_c = settings.gridsync_weight_carbon
    w_k = settings.gridsync_weight_captive

    for s in signals:
        norm_p = (s["price_rs_per_kwh"] - p_min) / p_range
        norm_c = (s["carbon_kg_per_kwh"] - c_min) / c_range
        captive_a = s["captive_availability"]
        s["window_score"] = round(w_p * norm_p + w_c * norm_c - w_k * captive_a, 4)

    await cache.set(cache_key, signals, ttl=900)  # 15-min cache
    return signals


def best_windows(
    signals: list[dict[str, Any]],
    run_hours: float,
    earliest_start: str = "00:00",
    latest_finish: str = "23:59",
) -> list[dict[str, Any]]:
    """Find the top-3 windows for a load of `run_hours` duration.

    Returns sorted list of windows: {"start": ..., "end": ..., "avg_score": ...,
    "avg_price": ..., "avg_carbon": ..., "saving_vs_worst_pct": ...}
    """
    blocks_needed = max(1, int(run_hours * 4))  # 4 blocks per hour

    # Filter to allowed window
    def _in_window(block: dict) -> bool:
        t = block["block_start_ist"][11:16]  # HH:MM
        return earliest_start <= t <= latest_finish

    filtered = [s for s in signals if _in_window(s)]
    if len(filtered) < blocks_needed:
        filtered = signals  # fallback: use full day

    # Sliding window sum of window_score
    windows = []
    for i in range(len(filtered) - blocks_needed + 1):
        window = filtered[i: i + blocks_needed]
        avg_score = sum(w["window_score"] for w in window) / blocks_needed
        avg_price = sum(w["price_rs_per_kwh"] for w in window) / blocks_needed
        avg_carbon = sum(w["carbon_kg_per_kwh"] for w in window) / blocks_needed
        windows.append({
            "start": window[0]["block_start_ist"],
            "end": window[-1]["block_start_ist"],
            "blocks": blocks_needed,
            "avg_score": round(avg_score, 4),
            "avg_price_rs_per_kwh": round(avg_price, 4),
            "avg_carbon_kg_per_kwh": round(avg_carbon, 4),
        })

    windows.sort(key=lambda x: x["avg_score"])

    # Add saving % vs worst window
    if windows:
        worst_price = max(w["avg_price_rs_per_kwh"] for w in windows)
        for w in windows:
            saving_pct = (worst_price - w["avg_price_rs_per_kwh"]) / worst_price * 100
            w["saving_vs_worst_pct"] = round(saving_pct, 1)

    return windows[:4]  # return top 4
