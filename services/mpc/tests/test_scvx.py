"""Tests for the SCvx drag-relinearization loop (SLS-27)."""

from __future__ import annotations

import numpy as np
import pytest

from mpc.aero import cd_at, density_at, drag_profile, speed_of_sound_at
from mpc.problem import SLOT_CENTRE, SolveInput, VehicleParams, solve_pdg
from mpc.scvx import SCvxOptions, solve_scvx

SUPER_HEAVY = VehicleParams(
    dry_mass_kg=200_000,
    max_thrust_n=29.9e6,
    min_thrust_n=2.76e6,
    isp_s=340.0,
)


def _final_descent_input() -> SolveInput:
    """Same feasible IC as tests/test_problem.py."""
    return SolveInput(
        position=np.array([50.0, 2_091.0, 300.0]),
        velocity=np.array([-5.0, -120.0, -40.0]),
        mass_kg=240_000.0,
        vehicle=SUPER_HEAVY,
    )


def _high_drag_input() -> SolveInput:
    """Faster, higher IC — dynamic pressure ~5× the final-descent case."""
    return SolveInput(
        position=np.array([50.0, 4_091.0, 600.0]),
        velocity=np.array([-5.0, -250.0, -80.0]),
        mass_kg=250_000.0,
        vehicle=SUPER_HEAVY,
    )


# --- aero parity spot checks (values mirror packages/physics tests) --------


def test_aero_subsonic_plateau_and_transonic_peak() -> None:
    assert cd_at(0.3, 0.7) == pytest.approx(0.7)
    assert cd_at(1.5, 0.7) == pytest.approx(0.7 * 1.8)
    assert cd_at(10.0, 0.7) == pytest.approx(0.7 * 1.5)


def test_aero_density_and_speed_of_sound() -> None:
    assert density_at(0.0) == pytest.approx(1.225)
    assert density_at(8_500.0) == pytest.approx(1.225 / np.e, rel=1e-9)
    # Sea-level ISA: a = sqrt(1.4 · 287.05 · 288.15) ≈ 340.3 m/s.
    assert speed_of_sound_at(0.0) == pytest.approx(340.3, abs=0.5)


# --- SCvx loop --------------------------------------------------------------


@pytest.fixture(scope="module")
def scvx_solution():
    return solve_scvx(_final_descent_input())


def test_scvx_converges_on_test_problem_ic(scvx_solution) -> None:
    """Converges on the test_problem.py IC — with an honest caveat.

    That IC was calibrated for the ZERO-drag model: its optimum rides the
    thrust floor for the whole flight. Once real drag is accounted for the
    floor over-decelerates the booster, so the drag-consistent fixed point
    stops ~60 m above the slot — SCvx converges and reports that honestly
    via terminal_slack instead of pretending the zero-drag plan works.
    """
    assert scvx_solution.status == "optimal"
    assert scvx_solution.converged
    assert 1 <= scvx_solution.iterations <= 5
    assert scvx_solution.terminal_slack < 100.0


def test_scvx_terminal_box_met_on_drag_feasible_ic() -> None:
    """A hotter arrival (floor not binding) hits the slot with ~zero slack."""
    inp = _final_descent_input()
    inp.velocity = np.array([-5.0, -160.0, -40.0])
    res = solve_scvx(inp)
    assert res.status == "optimal"
    assert res.converged
    r_f = res.positions[-1]
    assert np.linalg.norm(r_f - SLOT_CENTRE) <= 10.0 + res.terminal_slack + 1e-3
    assert res.terminal_slack < 1.0


def test_scvx_drag_is_nonzero_and_saves_fuel_on_high_drag_ic() -> None:
    inp = _high_drag_input()
    linear = solve_pdg(inp)
    scvx = solve_scvx(_high_drag_input())
    assert linear.status == "optimal"
    assert scvx.status == "optimal"

    # The drag profile along the converged trajectory is material.
    masses = np.full(len(scvx.positions), inp.mass_kg)
    prof = drag_profile(
        scvx.positions, scvx.velocities, masses,
        SCvxOptions().ref_area_m2, SCvxOptions().cd_subsonic,
    )
    assert np.max(np.linalg.norm(prof, axis=1)) > 1.0  # > 1 m/s² somewhere

    # Drag opposes the descent, so accounting for it needs LESS thrust:
    # the scvx plan burns measurably less fuel than the zero-drag plan.
    assert scvx.fuel_kg < linear.fuel_kg * 0.98
    assert scvx.terminal_slack <= linear.terminal_slack + 1e-3


def test_scvx_iteration_cap_respected() -> None:
    res = solve_scvx(
        _high_drag_input(),
        SCvxOptions(max_iterations=2, eps_converged=1e-9),
    )
    assert res.iterations <= 2
    assert res.status == "optimal"


def test_scvx_propagates_infeasible_status() -> None:
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
    res = solve_scvx(inp)
    assert res.status != "optimal" or res.terminal_slack > 10.0
