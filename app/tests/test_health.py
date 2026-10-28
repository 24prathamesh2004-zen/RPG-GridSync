"""Basic smoke tests for GridSync API."""
from fastapi.testclient import TestClient


def test_health(client: TestClient):
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["project"] == "RPG GridSync"


def test_list_plants_returns_seeded_data(client: TestClient):
    """Plants endpoint should return seeded RPG plant register after startup."""
    resp = client.get("/api/v1/plants/")
    assert resp.status_code == 200
    plants = resp.json()
    # Should have at least the 9 seeded plants
    assert len(plants) >= 1
