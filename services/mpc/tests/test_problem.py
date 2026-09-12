"""Unit tests for the parametric PDG SOCP (ADR-007).

The synthetic case is a Super-Heavy-like booster already on final descent:
2 km above the slot, modest lateral offset, falling at 80 m/s. Feasible by
construction — plenty of thrust authority and fuel.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from mpc.problem import (
    GLIDE_HALF_ANGLE_RAD,
    KEEPOUT_SLOPE,
    KEEPOUT_X0,
    SLOT_CENTRE,
    SolveInput,
    TERMINAL_POS_TOL_M,
    TERMINAL_VH_TOL_MPS,
    TERMINAL_VY_TOL_MPS,
    TOWER_SLOT_Y,
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


# ---------------------------------------------------------------------------
# Target parameterization (SLS-102)
# ---------------------------------------------------------------------------


def test_default_target_is_the_catch_slot() -> None:
    """Omitting the target is identical to naming the slot explicitly.

    Scope, precisely: this proves the dataclass default is wired to
    `SLOT_CENTRE`. It compares two POST-change paths, so it cannot detect the
    actual upgrade risk — CVXPY canonicalizing a folded constant differently
    from a stamped parameter. `test_default_target_matches_golden` covers
    that; this one covers the wiring.
    """
    implicit = solve_pdg(_final_descent_input())
    explicit_inp = _final_descent_input()
    explicit_inp.target_position = SLOT_CENTRE.copy()
    explicit = solve_pdg(explicit_inp)
    assert implicit.status == explicit.status == "optimal"
    # Bit-for-bit: the same parameter values are stamped either way.
    assert np.array_equal(implicit.positions, explicit.positions)
    assert np.array_equal(implicit.velocities, explicit.velocities)
    assert implicit.fuel_kg == explicit.fuel_kg
    assert implicit.t_f_s == explicit.t_f_s


def test_default_target_matches_golden() -> None:
    """Pin the default-target solve against values captured BEFORE SLS-102.

    Why this exists: turning `SLOT_CENTRE` from a folded numpy constant into
    a stamped `cp.Parameter` changes how CVXPY canonicalizes the problem, and
    nothing in the repo would have noticed if that had moved the answers.
    This project's README table, ADR prose and gate records are all
    CI-checked against benchmark numbers, so a silent shift in the guidance
    solution would drift them underneath their own consistency check.

    **What this guards, precisely: the OPTIMUM, not bit-reproducibility.**
    Two facts bound the useful tolerance:

    - Interior-point output is not reproducible to the last bit. The same
      solve run after a different sequence of preceding solves in the same
      process lands ~1e-4 m away (measured: 38.516007 vs 38.515906 on a
      position component — 0.1 mm). CI also runs Ubuntu x86 against a golden
      captured on macOS ARM.
    - A well-posed convex program has ONE optimum, so a re-canonicalization
      that preserves the mathematics converges to the same point within
      solver tolerance anyway. What actually moves the answer is a changed
      *formulation* — a mis-threaded target, a dropped or altered
      constraint — and that shows up in metres.

    So the tolerance is set at centimetres: far above the millimetre noise,
    far below any change worth noticing. Tightening it to 1e-6 makes this
    test order-dependent (verified: passes alone, fails inside the suite).

    To regenerate deliberately after an intended formulation change, see the
    generator in the SLS-102 PR description, and say so in the commit.
    """
    golden_path = Path(__file__).parent / "golden_default_target.json"
    golden = json.loads(golden_path.read_text())

    res = solve_pdg(_final_descent_input())
    assert res.status == "optimal"

    assert res.t_f_s == pytest.approx(golden["t_f_s"], rel=1e-4)
    assert res.fuel_kg == pytest.approx(golden["fuel_kg"], rel=1e-4)
    assert res.terminal_slack == pytest.approx(
        golden["terminal_slack"], abs=1e-3
    )
    for row, k in enumerate(golden["node_indices"]):
        # atol dominates near the origin, rtol out at 50 km downrange.
        np.testing.assert_allclose(
            res.positions[k], golden["positions"][row], rtol=1e-4, atol=0.05
        )
        np.testing.assert_allclose(
            res.velocities[k], golden["velocities"][row], rtol=1e-4, atol=0.05
        )


def test_offset_target_moves_the_terminal_state() -> None:
    """A displaced aim point must actually retarget the plan."""
    offset = SLOT_CENTRE + np.array([60.0, 0.0, 140.0])
    inp = _final_descent_input()
    inp.target_position = offset
    res = solve_pdg(inp)
    assert res.status == "optimal"
    r_f = res.positions[-1]
    slack = res.terminal_slack + 1e-3
    assert np.linalg.norm(r_f - offset) <= TERMINAL_POS_TOL_M + slack
    # …and it is genuinely somewhere else, not the old slot.
    assert np.linalg.norm(r_f - SLOT_CENTRE) > TERMINAL_POS_TOL_M


def test_offset_target_moves_the_glide_cone_apex() -> None:
    """The cone must follow the target, or the retargeted approach would be
    funnelled toward the slot and only diverge at the last node."""
    offset = SLOT_CENTRE + np.array([40.0, 0.0, 120.0])
    inp = _final_descent_input()
    inp.target_position = offset
    res = solve_pdg(inp)
    assert res.status == "optimal"
    n = len(res.positions) - 1
    tan_gs = np.tan(GLIDE_HALF_ANGLE_RAD)
    for k in range(3 * n // 4, n + 1):
        r = res.positions[k]
        lateral = np.linalg.norm(r[[0, 2]] - offset[[0, 2]])
        assert lateral <= tan_gs * (r[1] - offset[1]) + TERMINAL_POS_TOL_M + 1e-3


def test_keepout_plane_does_not_follow_the_target() -> None:
    """The tower does not move when the aim point does.

    Documents the SLS-103 boundary: the keep-out half-space stays anchored at
    the tower, so it still bounds x on the final quarter even for a target
    that has been nudged away from the slot.
    """
    offset = SLOT_CENTRE + np.array([25.0, 0.0, 90.0])
    inp = _final_descent_input()
    inp.target_position = offset
    res = solve_pdg(inp)
    assert res.status == "optimal"
    n = len(res.positions) - 1
    for k in range(n // 2, n + 1):
        r = res.positions[k]
        bound = KEEPOUT_X0 + KEEPOUT_SLOPE * (r[1] - TOWER_SLOT_Y)
        assert r[0] >= bound - 1e-3


def test_target_behind_the_tower_is_not_silently_accepted() -> None:
    """A far-side (x < keep-out) target is infeasible until SLS-103 relaxes
    the keep-out. It must surface as a bad plan, not as a confident one that
    quietly lands somewhere else."""
    behind = np.array([-400.0, TOWER_SLOT_Y, 0.0])
    inp = _final_descent_input()
    inp.target_position = behind
    res = solve_pdg(inp)
    assert res.status != "optimal" or res.terminal_slack > 10.0


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


def test_concurrent_solves_do_not_cross_targets() -> None:
    """Guard the shared-solver race (SLS-102 review finding).

    `_PDG` is a process-global mutable CVXPY problem and FastAPI runs the
    sync endpoint in a threadpool, so without a lock two in-flight requests
    interleave their parameter stamps. The dangerous shape is specifically
    two nearby states with DIFFERENT targets: the victim gets a plan whose
    node 0 matches its own vehicle (so the client's divergence guard passes)
    but whose terminal aims at the other request's target.
    """
    import concurrent.futures

    targets = [
        SLOT_CENTRE.copy(),
        SLOT_CENTRE + np.array([50.0, 0.0, 130.0]),
        SLOT_CENTRE + np.array([30.0, 0.0, -110.0]),
    ]

    def run(target: np.ndarray):
        inp = _final_descent_input()
        inp.target_position = target
        return target, solve_pdg(inp)

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        # Several rounds: a race needs the interleaving to actually land.
        for _ in range(4):
            for target, res in pool.map(run, targets):
                assert res.status == "optimal"
                miss = np.linalg.norm(res.positions[-1] - target)
                assert miss <= TERMINAL_POS_TOL_M + res.terminal_slack + 1e-3
