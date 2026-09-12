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
    # Linear mode carries no SCvx diagnostics.
    assert body["iterations"] is None
    assert body["converged"] is None


def test_solve_endpoint_scvx_mode() -> None:
    # −160 m/s vy: hot enough that the thrust floor is not binding once
    # drag is modelled, so the SCvx fixed point reaches the slot (the
    # −120 m/s IC converges ~60 m high — see tests/test_scvx.py).
    payload = {
        "position": {"x": 50.0, "y": 2091.0, "z": 300.0},
        "velocity": {"x": -5.0, "y": -160.0, "z": -40.0},
        "massKg": 240000.0,
        "vehicle": {
            "dryMassKg": 200000.0,
            "maxThrustN": 29.9e6,
            "minThrustN": 2.76e6,
            "ispS": 340.0,
        },
        "mode": "scvx",
    }
    resp = client.post("/solve", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "optimal"
    assert body["iterations"] >= 1
    assert isinstance(body["converged"], bool)
    last = body["predictedPositions"][-1]
    assert abs(last["y"] - 91.0) < 15.0


# ---------------------------------------------------------------------------
# targetPosition on the wire (SLS-102)
# ---------------------------------------------------------------------------

_BASE_PAYLOAD = {
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


def test_target_position_is_optional_and_defaults_to_the_slot() -> None:
    """Old clients omit the field; they must keep getting the slot plan."""
    omitted = client.post("/solve", json=_BASE_PAYLOAD).json()
    explicit = client.post(
        "/solve",
        json={**_BASE_PAYLOAD, "targetPosition": {"x": 8.5, "y": 91.0, "z": 0.0}},
    ).json()
    assert omitted["status"] == explicit["status"] == "optimal"
    assert omitted["predictedPositions"] == explicit["predictedPositions"]
    assert omitted["fuelKg"] == explicit["fuelKg"]


def test_target_position_retargets_the_plan() -> None:
    resp = client.post(
        "/solve",
        json={**_BASE_PAYLOAD, "targetPosition": {"x": 68.5, "y": 91.0, "z": 140.0}},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "optimal"
    last = body["predictedPositions"][-1]
    assert abs(last["x"] - 68.5) < 15.0
    assert abs(last["z"] - 140.0) < 15.0


def test_malformed_target_position_is_rejected() -> None:
    resp = client.post(
        "/solve", json={**_BASE_PAYLOAD, "targetPosition": {"x": 8.5, "y": 91.0}}
    )
    assert resp.status_code == 422
