"""SQLAlchemy async engine + session factory (SQLite / aiosqlite)."""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from shared.config import get_settings


def _make_engine():
    s = get_settings()
    # SQLite requires check_same_thread=False and no pool for async
    connect_args = {}
    if s.database_url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
    return create_async_engine(
        s.database_url,
        echo=False,
        pool_pre_ping=True,
        connect_args=connect_args,
    )


engine = _make_engine()
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


async def create_all_tables() -> None:
    """Create all ORM tables. Called at startup for SQLite dev setup."""
    import db.models  # noqa: F401  (register metadata on Base)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@asynccontextmanager
async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Async context manager for a DB session with auto commit/rollback."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
