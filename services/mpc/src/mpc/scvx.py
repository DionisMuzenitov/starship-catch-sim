"""Successive convexification (SCvx) around the lossless-convex PDG (SLS-27).

The v1 3-DOF model's only real nonlinearity is aerodynamic drag — the
lossless SOCP in ``problem.py`` treats it as an exogenous, known
per-node acceleration. SCvx closes that loop: solve the SOCP, evaluate
the *actual* drag (same Cd(M)/ISA model the simulator integrates, see
``aero.py``) along the resulting trajectory, re-stamp it as the next
iteration's exogenous profile, and repeat inside a trust region.

Scope note (deviation from the SLS-27 ticket text): the ticket lists
"attitude and aero" as the nonlinearities to successively convexify.
Attitude is not part of the 3-DOF service model at all (it lives in the
6-DOF sim + inner-loop PID), so v1 relinearizes drag only. Attitude
convexification belongs to a future 6-DOF ticket.

Trust region + acceptance follow the standard SCvx recipe
(Mao/Szmuk/Açıkmese lineage):

- hard per-node box ‖r_k − r̄_k‖_∞ ≤ R added to the SOCP (parametric, so
  the extended problem is still built once and re-stamped per call);
- step accepted/rejected on the ratio of ACTUAL to PREDICTED cost
  reduction, where the actual cost adds a penalty on the drag defect
  (assumed profile vs drag evaluated on the returned trajectory) and the
  convex model predicts zero defect;
- R grows ×2 on a good ratio (> 0.7), shrinks ×0.5 on a rejection
  (< 0.1).

Convergence: ‖r_k − r_{k−1}‖_∞ < eps on 2 consecutive accepted
iterations (the ticket's "3 consecutive" is overkill at the default
max_iterations = 5). Free final time is handled the same way as in
``solve_pdg``: the zero-drag warm start sweeps t_f, then every SCvx
iteration locally refines around the incumbent t_f (drag materially
shifts the optimal t_f — the thrust floor means extra drag deceleration
must be traded for a longer flight, so freezing t_f strands the terminal
state above the slot).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import cvxpy as cp
import numpy as np

from .aero import drag_profile
from .problem import (
    G,
    N,
    TERMINAL_SLACK_WEIGHT,
    SolveInput,
    SolveResult,
    _ParametricPDG,
    solve_pdg,
)

# Booster defaults, mirrors packages/physics/src/scenarios.ts
# (BOOSTER_REF_AREA = π·4.5², BOOSTER_CD = 0.7).
DEFAULT_REF_AREA_M2 = float(np.pi * 4.5 * 4.5)
DEFAULT_CD_SUBSONIC = 0.7

# Weight on the accumulated drag defect (m/s of velocity error over the
# horizon) in the ACTUAL-cost metric. Sized against the terminal-slack
# weight (1e4 per metre): 1 m/s of unmodelled velocity defect integrates
# to ~t_f/2 ≈ 10–15 m of terminal position error, so a defect must cost
# about 1e5 for "honest plan with slack" to beat "pretty plan whose drag
# assumption is a lie".
DEFECT_WEIGHT = 1e5

RATIO_REJECT = 0.1
RATIO_GROW = 0.7
TRUST_SHRINK = 0.5
TRUST_GROW = 2.0
CONSECUTIVE_CONVERGED = 2


@dataclass
class SCvxOptions:
    max_iterations: int = 5
    trust_radius0: float = 500.0  # m, per-node ∞-norm box on positions
    eps_converged: float = 5.0  # m, ‖r_k − r_{k−1}‖_∞
    ref_area_m2: float = DEFAULT_REF_AREA_M2
    cd_subsonic: float = DEFAULT_CD_SUBSONIC


@dataclass
class SCvxResult:
    status: str
    iterations: int = 0
    converged: bool = False
    t_f_s: float = 0.0
    solve_time_ms: float = 0.0
    fuel_kg: float = 0.0
    positions: np.ndarray = field(default_factory=lambda: np.zeros((0, 3)))
    velocities: np.ndarray = field(default_factory=lambda: np.zeros((0, 3)))
    thrust_accel: np.ndarray = field(default_factory=lambda: np.zeros((0, 3)))
    throttle: np.ndarray = field(default_factory=lambda: np.zeros(0))
    terminal_slack: float = 0.0


class _TrustRegionPDG(_ParametricPDG):
    """The parametric PDG plus a per-node ∞-norm position trust region."""

    def __init__(self) -> None:
        super().__init__()
        self.p_r_ref = cp.Parameter((N + 1, 3), name="r_ref")
        self.p_trust_radius = cp.Parameter(nonneg=True, name="trust_radius")
        cons = [
            *self.base_constraints,
            cp.abs(self.r - self.p_r_ref) <= self.p_trust_radius,
        ]
        self.problem = cp.Problem(self.objective, cons)


_TR_PDG = _TrustRegionPDG()


def _mass_trajectory(inp: SolveInput, res: SolveResult, dt: float) -> np.ndarray:
    """Node masses implied by the SOCP thrust profile (exact w.r.t. z-dyn)."""
    alpha = 1.0 / (inp.vehicle.isp_s * G)
    sigma = np.linalg.norm(res.thrust_accel, axis=1)
    z0 = np.log(inp.mass_kg)
    z = z0 - alpha * dt * np.concatenate(([0.0], np.cumsum(sigma)))
    return np.exp(z)


def _defect(prof_assumed: np.ndarray, prof_actual: np.ndarray, dt: float) -> float:
    """Accumulated drag mismatch over the horizon (m/s)."""
    return float(np.sum(np.linalg.norm(prof_actual - prof_assumed, axis=1)) * dt)


def _convex_cost(res: SolveResult) -> float:
    return res.fuel_kg + TERMINAL_SLACK_WEIGHT * res.terminal_slack


def _actual_drag(
    inp: SolveInput, res: SolveResult, dt: float, opt: SCvxOptions
) -> np.ndarray:
    masses = _mass_trajectory(inp, res, dt)
    return drag_profile(
        res.positions, res.velocities, masses, opt.ref_area_m2, opt.cd_subsonic
    )


def solve_scvx(inp: SolveInput, options: SCvxOptions | None = None) -> SCvxResult:
    opt = options or SCvxOptions()
    t_start = time.perf_counter()

    # Iteration 1: zero-drag (or caller-profile) lossless solve, which also
    # picks t_f via the sweep/refinement in solve_pdg.
    best = solve_pdg(inp)
    iterations = 1
    if best.status != "optimal":
        return SCvxResult(
            status=best.status,
            iterations=iterations,
            solve_time_ms=(time.perf_counter() - t_start) * 1e3,
        )

    t_f = best.t_f_s
    dt = t_f / N
    drag_used = (
        inp.drag_accel if inp.drag_accel is not None else np.zeros((N, 3))
    )
    best_actual_cost = _convex_cost(best) + DEFECT_WEIGHT * _defect(
        drag_used, _actual_drag(inp, best, dt, opt), dt
    )

    radius = opt.trust_radius0
    consecutive = 0
    converged = False

    while iterations < opt.max_iterations:
        # Re-linearize drag about the incumbent trajectory.
        drag_next = _actual_drag(inp, best, dt, opt)
        trial_inp = SolveInput(
            position=inp.position,
            velocity=inp.velocity,
            mass_kg=inp.mass_kg,
            vehicle=inp.vehicle,
            drag_accel=drag_next,
        )
        _TR_PDG.p_r_ref.value = best.positions
        _TR_PDG.p_trust_radius.value = radius
        # Free final time: local 3-point refinement around the incumbent
        # t_f (mirrors the warm-replan path in solve_pdg).
        trial: SolveResult | None = None
        trial_tf = t_f
        for factor in (0.92, 1.0, 1.08):
            cand_tf = t_f * factor
            cand = _TR_PDG.stamp_and_solve(trial_inp, cand_tf)
            if cand.status != "optimal":
                continue
            if trial is None or _convex_cost(cand) < _convex_cost(trial):
                trial = cand
                trial_tf = cand_tf
        iterations += 1
        if trial is None:
            # Numerical trouble inside the trust region — shrink and retry.
            radius *= TRUST_SHRINK
            consecutive = 0
            continue

        trial_dt = trial_tf / N
        predicted_cost = _convex_cost(trial)  # convex model: zero defect
        actual_cost = predicted_cost + DEFECT_WEIGHT * _defect(
            drag_next, _actual_drag(inp, trial, trial_dt, opt), trial_dt
        )
        predicted_reduction = best_actual_cost - predicted_cost
        actual_reduction = best_actual_cost - actual_cost
        ratio = (
            actual_reduction / predicted_reduction
            if predicted_reduction > 1e-9
            else (1.0 if actual_reduction >= 0 else -1.0)
        )

        if ratio < RATIO_REJECT:
            radius *= TRUST_SHRINK
            consecutive = 0
            continue
        if ratio > RATIO_GROW:
            radius *= TRUST_GROW

        step = float(np.max(np.abs(trial.positions - best.positions)))
        best = trial
        best_actual_cost = actual_cost
        t_f = trial_tf
        dt = trial_dt
        consecutive = consecutive + 1 if step < opt.eps_converged else 0
        if consecutive >= CONSECUTIVE_CONVERGED:
            converged = True
            break

    return SCvxResult(
        status="optimal",
        iterations=iterations,
        converged=converged,
        t_f_s=t_f,
        solve_time_ms=(time.perf_counter() - t_start) * 1e3,
        fuel_kg=best.fuel_kg,
        positions=best.positions,
        velocities=best.velocities,
        thrust_accel=best.thrust_accel,
        throttle=best.throttle,
        terminal_slack=best.terminal_slack,
    )
