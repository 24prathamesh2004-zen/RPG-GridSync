"""Central configuration — reads from .env via pydantic-settings.

GridSync uses:
  - SQLite (no PostgreSQL)
  - In-process dict cache (no Redis)
  - Groq LLM API
  - Open-Meteo weather (no key)
  - IEX India public market data (no key)
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env",
        extra="ignore",
    )

    # ── App ────────────────────────────────────────────────────────────────────
    app_env: str = "development"
    app_secret_key: str = "change-me"
    log_level: str = "INFO"
    cors_allowed_origins: str = ""

    # ── Database (SQLite) ──────────────────────────────────────────────────────
    database_url: str = "sqlite+aiosqlite:///./gridsync.db"

    # ── LLM — Groq ─────────────────────────────────────────────────────────────
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"

    # ── Market data backup ────────────────────────────────────────────────────
    energymap_api_key: str = ""

    # ── GridSync domain settings ───────────────────────────────────────────────
    gridsync_weight_price: float = 0.50
    gridsync_weight_carbon: float = 0.30
    gridsync_weight_captive: float = 0.20
    daily_recommendation_enabled: bool = True
    daily_recommendation_time: str = "06:30"

    # ── Security validators ────────────────────────────────────────────────────
    @model_validator(mode="after")
    def _enforce_secret_key(self) -> "Settings":
        if self.app_env == "production" and self.app_secret_key == "change-me":
            raise ValueError(
                "APP_SECRET_KEY must not be 'change-me' in production."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
