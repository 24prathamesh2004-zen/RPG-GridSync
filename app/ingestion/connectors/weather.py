"""Open-Meteo weather and solar forecast connector — D7.

Free for non-commercial use. No API key required.
Docs: https://open-meteo.com/en/docs

Returns hourly forecasts for a given lat/lon:
  - direct_radiation (W/m²) — proxy for rooftop solar output
  - cloud_cover (%) — affects captive solar yield
  - wind_speed_10m (km/h) — proxy for captive wind yield
  - temperature_2m (°C) — affects cooling loads

For production, switch to a paid Open-Meteo plan or India Meteorological
Department (IMD) API.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Any

import httpx

log = logging.getLogger("ingestion.weather")

_OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# Default fallback values when API is unavailable
_FALLBACK_RADIATION_WM2 = 400.0  # typical daytime for India
_FALLBACK_WIND_KMH = 12.0


async def fetch_solar_wind_forecast(
    latitude: float,
    longitude: float,
    for_date: date | None = None,
) -> list[dict[str, Any]]:
    """Fetch hourly solar radiation and wind speed for the next 2 days.

    Returns list of dicts:
      {"hour_ist": "2026-10-15T08:00", "direct_radiation_wm2": 650.0,
       "cloud_cover_pct": 20, "wind_speed_kmh": 14.0,
       "temperature_c": 28.5, "source": "open_meteo", "status": "fresh"}
    """
    target = for_date or date.today()
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "hourly": "direct_radiation,cloud_cover,wind_speed_10m,temperature_2m",
        "timezone": "Asia/Kolkata",
        "start_date": target.strftime("%Y-%m-%d"),
        "end_date": (target.replace(day=target.day + 1) if target.day < 28
                     else target).strftime("%Y-%m-%d"),
        "forecast_days": 2,
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(_OPEN_METEO_URL, params=params)
            if resp.status_code == 200:
                return _parse_open_meteo(resp.json())
    except Exception as exc:
        log.warning("open_meteo_fetch_failed lat=%s lon=%s error=%s", latitude, longitude, exc)

    return _flat_fallback(target)


def _parse_open_meteo(data: dict) -> list[dict[str, Any]]:
    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    radiation = hourly.get("direct_radiation", [])
    cloud = hourly.get("cloud_cover", [])
    wind = hourly.get("wind_speed_10m", [])
    temp = hourly.get("temperature_2m", [])

    records = []
    for i, t in enumerate(times):
        records.append({
            "hour_ist": t,
            "direct_radiation_wm2": float(radiation[i]) if i < len(radiation) else _FALLBACK_RADIATION_WM2,
            "cloud_cover_pct": float(cloud[i]) if i < len(cloud) else 30.0,
            "wind_speed_kmh": float(wind[i]) if i < len(wind) else _FALLBACK_WIND_KMH,
            "temperature_c": float(temp[i]) if i < len(temp) else 28.0,
            "source": "open_meteo",
            "status": "fresh",
        })
    return records


def _flat_fallback(target: date) -> list[dict[str, Any]]:
    """Return a synthetic 24-hour profile for the target date."""
    from datetime import datetime, timedelta
    records = []
    base = datetime(target.year, target.month, target.day)
    for h in range(48):  # 2 days
        dt = base + timedelta(hours=h)
        hour = dt.hour
        # Rough India solar profile: sunrise 6, peak noon, sunset 18
        if 6 <= hour <= 18:
            radiation = max(0.0, _FALLBACK_RADIATION_WM2 * (1 - abs(hour - 12) / 6))
        else:
            radiation = 0.0
        records.append({
            "hour_ist": dt.strftime("%Y-%m-%dT%H:00"),
            "direct_radiation_wm2": radiation,
            "cloud_cover_pct": 30.0,
            "wind_speed_kmh": _FALLBACK_WIND_KMH,
            "temperature_c": 28.0,
            "source": "open_meteo_fallback",
            "status": "estimated",
        })
    return records


def solar_availability_index(radiation_wm2: float, cloud_cover_pct: float) -> float:
    """Return 0–1 captive solar availability index for a given hour.

    Scales peak radiation (~1000 W/m²) to 1.0.
    Reduces by cloud cover.
    """
    base = min(radiation_wm2 / 1000.0, 1.0)
    cloud_factor = 1.0 - (cloud_cover_pct / 100.0) * 0.4  # clouds reduce output by up to 40%
    return round(base * cloud_factor, 3)


def wind_availability_index(wind_kmh: float) -> float:
    """Return 0–1 captive wind availability index.

    Assumes a typical small industrial wind turbine cut-in at 10 km/h,
    rated at 45 km/h.
    """
    if wind_kmh < 10:
        return 0.0
    return round(min((wind_kmh - 10) / 35.0, 1.0), 3)
