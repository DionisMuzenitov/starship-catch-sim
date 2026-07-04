"""Unit tests for the parametric PDG SOCP (ADR-007).

The synthetic case is a Super-Heavy-like booster already on final descent:
2 km above the slot, modest lateral offset, falling at 80 m/s. Feasible by
construction — plenty of thrust authority and fuel.
"""

from __future__ import annotations

import numpy as np
import pytest

from mpc.problem import (
    GLIDE_HALF_ANGLE_RAD,
    SLOT_CENTRE,
    SolveInput,
    TERMINAL_POS_TOL_M,
    TERMINAL_VH_TOL_MPS,
    TERMINAL_VY_TOL_MPS,
    VehicleParams,
    solve_pdg,
)

SUPER_HEAVY = VehicleParams(
    dry_mass_kg=200_000,
    max_thrust_n=29.9e6,  # 13 landing engines × 2.3 MN
    min_thrust_n=2.76e6,  # 3 centre engines × 0.4 floor × 2.3 MN
    isp_s=340.0,
)


def _final_descent_input() -> SolveInput:
    # Feasibility note: the thrust floor (min accel ≈ 11.5 m/s² on 240 t)
    # means the burn can shed at most (11.5 − g) ≈ 1.7 m/s² net downward
    # decel at idle — so the IC must arrive fast enough that the required
    # average decel v²/2h exceeds that (here 14 400/4 000 = 3.6 m/s²).
    return SolveInput(
        position=np.array([50.0, 2_091.0, 300.0]),
        velocity=np.array([-5.0, -120.0, -40.0]),
        mass_kg=240_000.0,
        vehicle=SUPER_HEAVY,
    )


@pytest.fixture(scope="module")
def solution():
    return solve_pdg(_final_descent_input())


def test_solves_to_optimal(solution) -> None:
    assert solution.status == "optimal"


def test_terminal_box_met_within_slack(solution) -> None:
    r_f = solution.positions[-1]
    v_f = solution.velocities[-1]
    slack = solution.terminal_slack + 1e-3
    assert np.linalg.norm(r_f - SLOT_CENTRE) <= TERMINAL_POS_TOL_M + slack
    assert abs(v_f[1]) <= TERMINAL_VY_TOL_MPS + slack
    assert np.linalg.norm(v_f[[0, 2]]) <= TERMINAL_VH_TOL_MPS + slack
    # A comfortably feasible case should not need material slack.
    assert solution.terminal_slack < 1.0


def test_fuel_burn_is_positive_and_sane(solution) -> None:
    assert 0 < solution.fuel_kg < 40_000.0


def test_throttle_within_engine_bounds(solution) -> None:
    # Throttle is normalized against max thrust; the floor maps to
    # min/max ≈ 0.092. Allow small numerical slop.
    assert np.all(solution.throttle <= 1.0 + 1e-6)
    assert np.all(solution.throttle >= SUPER_HEAVY.min_thrust_n
                  / SUPER_HEAVY.max_thrust_n - 1e-6)


def test_glide_cone_respected_on_final_quarter(solution) -> None:
    n = len(solution.positions) - 1
    tan_gs = np.tan(GLIDE_HALF_ANGLE_RAD)
    for k in range(3 * n // 4, n + 1):
        r = solution.positions[k]
        lateral = np.linalg.norm(r[[0, 2]] - SLOT_CENTRE[[0, 2]])
        assert lateral <= tan_gs * (r[1] - SLOT_CENTRE[1]) + TERMINAL_POS_TOL_M + 1e-3


def test_replan_with_hint_is_fast_and_optimal(solution) -> None:
    inp = _final_descent_input()
    inp.t_f_hint_s = solution.t_f_s
    res = solve_pdg(inp)
    assert res.status == "optimal"
    # 3-point refinement, parametric re-stamp: comfortably under the
    # 80 ms p99 target even on CI hardware.
    assert res.solve_time_ms < 500.0


def test_fuel_budget_blocks_high_altitude_full_burn() -> None:
    # From 63 km falling 278 m/s the only "solutions" are ~250 s full burns
    # that would spend far more propellant than the ~300 t aboard. With the
    # z[N] ≥ ln(dry+reserve) budget constraint these must come back either
    # non-optimal or slack-soaked — never a clean plan (regression: the
    # SLS-27 bench caught the controller tracking a 299 t-burn "optimal"
    # plan that drained the tank at t≈30 s).
    inp = SolveInput(
        position=np.array([0.0, 63_091.0, 47_000.0]),
        velocity=np.array([0.0, -278.0, -100.0]),
        mass_kg=500_000.0,
        vehicle=SUPER_HEAVY,
    )
    res = solve_pdg(inp)
    assert res.status != "optimal" or res.terminal_slack > 5.0
    if res.status == "optimal":
        # Whatever comes back may not burn below the dry+reserve floor.
        assert res.fuel_kg <= 500_000.0 - SUPER_HEAVY.dry_mass_kg + 1.0


def test_infeasible_case_reports_not_optimal() -> None:
    # Below the slot moving down fast with almost no thrust: hopeless.
    inp = SolveInput(
        position=np.array([0.0, 30.0, 0.0]),
        velocity=np.array([0.0, -200.0, 0.0]),
        mass_kg=240_000.0,
        vehicle=VehicleParams(
            dry_mass_kg=200_000,
            max_thrust_n=1e5,
            min_thrust_n=4e4,
            isp_s=340.0,
        ),
    )
    res = solve_pdg(inp)
    # Terminal slack may rescue "solvable but bad"; either a non-optimal
    # status or an enormous slack is acceptable — what matters is that the
    # result is clearly flagged as not a usable plan.
    assert res.status != "optimal" or res.terminal_slack > 10.0
