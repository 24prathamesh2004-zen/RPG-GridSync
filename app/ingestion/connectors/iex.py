"""IEX India market data connector — D1 (Day-Ahead Market) and D2 (Real-Time Market).

Public endpoint: https://www.iexindia.com/marketdata/
Data returned in 15-minute blocks for India Standard Time.

Fallback: if IEX is unreachable, returns a flat ToD tariff estimate.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx

from shared.cache import get_cache
from shared.config import get_settings

log = logging.getLogger("ingestion.iex")

# IEX public API base (unofficial; check terms for production use)
_IEX_BASE = "https://www.iexindia.com/api"
_ENERGYMAP_BASE = "https://api.energymap.in/developer/v1/market/iex/latest"
_IST = timezone(timedelta(hours=5, minutes=30), name="IST")

# India average HT industrial flat tariff used as fallback when IEX is down
_FALLBACK_PRICE_RS_MWH = 4300.0  # ₹4.30/kWh expressed as ₹/MWh


async def fetch_dam_prices(for_date: date | None = None) -> list[dict[str, Any]]:
    """Fetch Day-Ahead Market (DAM) prices for a given date.

    Returns list of dicts:
      {"block_start_ist": "2026-10-15T00:00", "price_rs_per_mwh": 3850.0,
       "volume_mwh": 120.5, "source": "iex_dam", "status": "fresh"}

    Falls back to flat tariff on any error.
    """
    target = for_date or date.today()
    cache = get_cache()
    cache_key = f"market:dam:{target.isoformat()}"
    cached = await cache.get(cache_key)
    if cached is not None:
        return cached

    # IEX DAM prices are typically available for next day after ~17:00 IST
    date_str = target.strftime("%d-%m-%Y")
    url = f"{_IEX_BASE}/dam/prices?date={date_str}"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers={"Accept": "application/json"})
            if resp.status_code == 200:
                data = resp.json()
                records = _parse_iex_response(data, target, "iex_dam")
                if any(record["status"] == "fresh" for record in records):
                    await cache.set(cache_key, records, ttl=900)
                    return records
    except Exception as exc:
        log.warning("iex_dam_fetch_failed date=%s error=%s — using fallback", date_str, exc)

    energymap = await _fetch_energymap_prices(target, "DAM")
    if energymap:
        await cache.set(cache_key, energymap, ttl=900)
        return energymap

    # RTM is a useful live-price fallback when no DAM blocks are available.
    energymap_rtm = await _fetch_energymap_prices(target, "RTM")
    if energymap_rtm:
        await cache.set(cache_key, energymap_rtm, ttl=900)
        return energymap_rtm

    fallback = _flat_fallback(target, "iex_dam")
    await cache.set(cache_key, fallback, ttl=900)
    return fallback


async def fetch_rtm_prices(for_date: date | None = None) -> list[dict[str, Any]]:
    """Fetch Real-Time Market (RTM) prices. Falls back to last DAM or flat tariff."""
    target = for_date or date.today()
    cache = get_cache()
    cache_key = f"market:rtm:{target.isoformat()}"
    cached = await cache.get(cache_key)
    if cached is not None:
        return cached

    date_str = target.strftime("%d-%m-%Y")
    url = f"{_IEX_BASE}/rtm/prices?date={date_str}"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers={"Accept": "application/json"})
            if resp.status_code == 200:
                data = resp.json()
                records = _parse_iex_response(data, target, "iex_rtm")
                if any(record["status"] == "fresh" for record in records):
                    await cache.set(cache_key, records, ttl=900)
                    return records
    except Exception as exc:
        log.warning("iex_rtm_fetch_failed date=%s error=%s — using fallback", date_str, exc)

    energymap = await _fetch_energymap_prices(target, "RTM")
    if energymap:
        await cache.set(cache_key, energymap, ttl=900)
        return energymap

    fallback = _flat_fallback(target, "iex_rtm")
    await cache.set(cache_key, fallback, ttl=900)
    return fallback


async def _fetch_energymap_prices(target: date, market_type: str) -> list[dict[str, Any]]:
    """Fetch latest EnergyMap IEX blocks and retain those for the requested IST date."""
    api_key = get_settings().energymap_api_key.strip()
    if not api_key:
        return []

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                _ENERGYMAP_BASE,
                params={"market_type": market_type, "limit": 96},
                headers={"Accept": "application/json", "X-API-Key": api_key},
            )
        if resp.status_code != 200:
            log.warning("energymap_fetch_failed market=%s status=%d", market_type, resp.status_code)
            return []
        return _parse_energymap_response(resp.json(), target, market_type)
    except Exception as exc:
        log.warning("energymap_fetch_failed market=%s error=%s", market_type, exc)
        return []


def _parse_energymap_response(
    data: Any, target: date, market_type: str
) -> list[dict[str, Any]]:
    """Normalize EnergyMap's {data, meta} UTC timestamp envelope to IST blocks."""
    if not isinstance(data, dict) or not isinstance(data.get("data"), list):
        return []

    records = []
    for item in data["data"]:
        if not isinstance(item, dict):
            continue
        try:
            timestamp = datetime.fromisoformat(
                str(item["timestamp"]).replace("Z", "+00:00")
            )
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=timezone.utc)
            block_start = timestamp.astimezone(_IST)
            price = float(item["mcp_rs_mwh"])
            if block_start.date() != target or not (price == price and abs(price) != float("inf")):
                continue
            if block_start.minute % 15 != 0 or block_start.second or block_start.microsecond:
                continue
        except (KeyError, TypeError, ValueError, OverflowError):
            continue

        try:
            volume_mwh = float(item.get("mcv_mw") or 0.0) * 0.25
        except (TypeError, ValueError):
            volume_mwh = 0.0

        records.append({
            "block_start_ist": block_start.strftime("%Y-%m-%dT%H:%M"),
            "price_rs_per_mwh": price,
            "volume_mwh": volume_mwh,
            "source": f"energymap_{market_type.lower()}",
            "status": "fresh",
        })

    return sorted(records, key=lambda record: record["block_start_ist"])


def _parse_iex_response(data: Any, target: date, source: str) -> list[dict[str, Any]]:
    """Attempt to parse IEX response. Returns fallback on parse failure."""
    try:
        records = []
        if isinstance(data, list):
            for item in data:
                block_no = int(item.get("block", item.get("blockNo", 0)))
                price = float(item.get("mcp", item.get("price", _FALLBACK_PRICE_RS_MWH)))
                volume = float(item.get("mcv", item.get("volume", 0.0)))
                # 15-min blocks: block 1 = 00:00–00:15
                minutes_offset = (block_no - 1) * 15
                block_start = datetime(target.year, target.month, target.day) + timedelta(minutes=minutes_offset)
                records.append({
                    "block_start_ist": block_start.strftime("%Y-%m-%dT%H:%M"),
                    "price_rs_per_mwh": price,
                    "volume_mwh": volume,
                    "source": source,
                    "status": "fresh",
                })
        if records:
            return records
    except Exception as exc:
        log.warning("iex_parse_failed source=%s error=%s", source, exc)

    return _flat_fallback(target, source)


def _flat_fallback(target: date, source: str) -> list[dict[str, Any]]:
    """Generate 96 flat-tariff blocks (15-min, full day) as fallback."""
    records = []
    base = datetime(target.year, target.month, target.day)
    for block in range(96):
        block_dt = base + timedelta(minutes=block * 15)
        hour = block_dt.hour
        # Simple ToD approximation: peak hours cost more
        if 6 <= hour < 10 or 18 <= hour < 22:
            price = 4750.0  # peak surcharge ~45 paise extra
        elif 22 <= hour or hour < 6:
            price = 3900.0  # night rebate ~40 paise
        else:
            price = 4300.0  # base
        records.append({
            "block_start_ist": block_dt.strftime("%Y-%m-%dT%H:%M"),
            "price_rs_per_mwh": price,
            "volume_mwh": 0.0,
            "source": f"{source}_fallback",
            "status": "estimated",
        })
    return records
