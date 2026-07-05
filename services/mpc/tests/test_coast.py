"""Coast-phase ignition planning tests (SLS-47).

The headline case is the exact BoosterDescentCalm IC that burn-only
guidance could never plan from: 65 km up, 360 m/s, 50 km downrange.
"""

from __future__ import annotations

import numpy as np
import pytest

from fastapi.testclient import TestClient

from mpc.coast import (
    MIN_IGNITION_ALTITUDE_M,
    propagate_ballistic,
    solve_coast_burn,
)
from mpc.problem import SLOT_CENTRE, SolveInput, VehicleParams
from mpc.server import app

SUPER_HEAVY = VehicleParams(
    dry_mass_kg=200_000,
    max_thrust_n=26.65e6,  # 13 landing engines × 2.05 MN sea-level
    min_thrust_n=2.46e6,  # 3 centre engines × 0.4 floor
    isp_s=327.0,
)

# BoosterDescentCalm initial state (scenarios.ts), no jitter.
CALM_INPUT = SolveInput(
    position=np.array([0.0, 65_000.0, 50_000.0]),
    velocity=np.array([0.0, -200.0, -300.0]),
    mass_kg=527_374.0,
    vehicle=SUPER_HEAVY,
)


class TestPropagateBallistic:
    def test_descends_and_stops_at_ignition_floor(self) -> None:
        times, rs, vs = propagate_ballistic(
            CALM_INPUT.position, CALM_INPUT.velocity, CALM_INPUT.mass_kg, SUPER_HEAVY
        )
        assert rs[0, 1] == 65_000.0
        assert rs[-1, 1] <= rs[0, 1]
        # Ends at the floor (or the time cap) — never below the floor by
        # more than one step's fall.
        floor = SLOT_CENTRE[1] + MIN_IGNITION_ALTITUDE_M
        assert rs[-1, 1] > floor - 500.0
        assert np.all(np.diff(times) > 0)

    def test_drag_limits_terminal_velocity(self) -> None:
        # With Cd(M) drag the fall from 65 km must stay well below the
        # vacuum free-fall speed (~1.1 km/s); the dense lower atmosphere
        # brakes the booster hard through the transonic regime.
        _, rs, vs = propagate_ballistic(
            CALM_INPUT.position, CALM_INPUT.velocity, CALM_INPUT.mass_kg, SUPER_HEAVY
        )
        speeds = np.linalg.norm(vs, axis=1)
        assert speeds.max() < 1_100.0
        # And the low-altitude end is materially slower than the peak.
        assert speeds[-1] < 0.75 * speeds.max()


@pytest.fixture(scope="module")
def calm_plan():
    return solve_coast_burn(CALM_INPUT)


class TestSolveCoastBurn:

    def test_finds_usable_plan_from_calm_ic(self, calm_plan) -> None:
        # THE case burn-only guidance failed on since SLS-26.
        assert calm_plan.status == "optimal"
        assert calm_plan.burn.terminal_slack <= 5.0

    def test_ignition_is_a_real_coast(self, calm_plan) -> None:
        assert calm_plan.ignition_time_s > 10.0
        # Ignition happens above the floor and below the start.
        ign = calm_plan.coast_positions[-1]
        assert SLOT_CENTRE[1] + MIN_IGNITION_ALTITUDE_M - 500 < ign[1] < 65_000.0

    def test_coast_ends_where_burn_begins(self, calm_plan) -> None:
        np.testing.assert_allclose(
            calm_plan.coast_positions[-1], calm_plan.burn.positions[0], atol=1e-6
        )

    def test_burn_lands_at_the_slot(self, calm_plan) -> None:
        end = calm_plan.burn.positions[-1]
        assert np.linalg.norm(end - SLOT_CENTRE) <= 10.0 + calm_plan.burn.terminal_slack + 1e-3

    def test_fuel_within_budget(self, calm_plan) -> None:
        available = CALM_INPUT.mass_kg - SUPER_HEAVY.dry_mass_kg
        assert 0 < calm_plan.burn.fuel_kg <= available

    def test_hopeless_case_reports_infeasible(self) -> None:
        # Tiny thrust: no ignition time helps.
        weak = SolveInput(
            position=np.array([0.0, 65_000.0, 50_000.0]),
            velocity=np.array([0.0, -200.0, -300.0]),
            mass_kg=527_374.0,
            vehicle=VehicleParams(
                dry_mass_kg=200_000,
                max_thrust_n=1e5,
                min_thrust_n=4e4,
                isp_s=327.0,
            ),
        )
        assert solve_coast_burn(weak).status != "optimal"


def test_server_coast_burn_round_trip() -> None:
    client = TestClient(app)
    payload = {
        "position": {"x": 0.0, "y": 65_000.0, "z": 50_000.0},
        "velocity": {"x": 0.0, "y": -200.0, "z": -300.0},
        "massKg": 527_374.0,
        "vehicle": {
            "dryMassKg": 200_000.0,
            "maxThrustN": 26.65e6,
            "minThrustN": 2.46e6,
            "ispS": 327.0,
        },
        "mode": "coast+burn",
    }
    body = client.post("/solve", json=payload).json()
    assert body["status"] == "optimal"
    assert body["ignitionTimeS"] > 10.0
    assert len(body["coastPositions"]) >= 2
    # Coast tail == burn head.
    tail = body["coastPositions"][-1]
    head = body["predictedPositions"][0]
    assert abs(tail["y"] - head["y"]) < 1e-6
    # Burn-only modes keep the new fields null.
    body2 = client.post("/solve", json={**payload, "mode": "linear"}).json()
    assert body2["ignitionTimeS"] is None
