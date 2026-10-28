"""Pytest fixtures for GridSync tests."""
from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from api.main import app


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as c:
        yield c
