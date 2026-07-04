"""API-level test: POST /solve round-trips JSON and returns a plan."""

from __future__ import annotations

from fastapi.testclient import TestClient

from mpc.server import app

client = TestClient(app)


def test_health() -> None:
    assert client.get("/health").json() == {"status": "ok"}


def test_solve_endpoint_returns_plan() -> None:
    payload = {
        "position": {"x": 50.0, "y": 2091.0, "z": 300.0},
        "velocity": {"x": -5.0, "y": -120.0, "z": -40.0},
        "massKg": 240000.0,
        "vehicle": {
            "dryMassKg": 200000.0,
            "maxThrustN": 29.9e6,
            "minThrustN": 2.76e6,
            "ispS": 340.0,
        },
    }
    resp = client.post("/solve", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "optimal"
    assert body["tFS"] > 0
    assert len(body["predictedPositions"]) == len(body["predictedVelocities"])
    assert len(body["thrustAccel"]) == len(body["throttle"])
    assert len(body["predictedPositions"]) == len(body["thrustAccel"]) + 1
    # Terminal node lands at the slot.
    last = body["predictedPositions"][-1]
    assert abs(last["y"] - 91.0) < 15.0
