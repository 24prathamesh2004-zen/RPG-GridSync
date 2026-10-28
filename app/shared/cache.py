"""Simple in-process TTL cache — replaces Redis for local/SQLite deployments.

Thread-safe for asyncio; uses asyncio.Lock. Not suitable for multi-process
deployments (use Redis instead). Good for dev and single-instance production.

Usage:
    cache = get_cache()
    await cache.set("key", {"data": 123}, ttl=300)
    val = await cache.get("key")   # None if expired or missing
    await cache.delete("key")
"""
from __future__ import annotations

import asyncio
import time
from functools import lru_cache
from typing import Any


class MemoryCache:
    def __init__(self) -> None:
        self._store: dict[str, tuple[Any, float]] = {}  # key -> (value, expires_at)
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Any | None:
        async with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expires_at = entry
            if expires_at and time.monotonic() > expires_at:
                del self._store[key]
                return None
            return value

    async def set(self, key: str, value: Any, ttl: int = 300) -> None:
        """Store value with TTL in seconds (0 = never expire)."""
        async with self._lock:
            expires_at = (time.monotonic() + ttl) if ttl else 0.0
            self._store[key] = (value, expires_at)

    async def delete(self, key: str) -> None:
        async with self._lock:
            self._store.pop(key, None)

    async def clear(self) -> None:
        async with self._lock:
            self._store.clear()

    async def keys(self, prefix: str = "") -> list[str]:
        async with self._lock:
            now = time.monotonic()
            return [
                k for k, (_, exp) in self._store.items()
                if k.startswith(prefix) and (exp == 0 or now < exp)
            ]


@lru_cache(maxsize=1)
def get_cache() -> MemoryCache:
    return MemoryCache()
