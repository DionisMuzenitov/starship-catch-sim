"""3-DOF lossless-convex powered-descent SOCP (ADR-007).

Formulation: Açıkmese & Blackmore, IEEE TCST 2013 (G-FOLD lineage), adapted
to the Mechazilla catch geometry. The CVXPY problem is built ONCE at module
load with `cp.Parameter`s for everything that changes between solves, so a
re-plan only re-stamps parameter values and calls `problem.solve()` — this
keeps per-call overhead in the low milliseconds (DPP-compliant graph).

Axes match the simulator: +y up, catch slot centre at ≈ (8.5, 91, 0),
approach from +z (scenario ICs start 50 km downrange in +z).

Deliberate v1 simplifications (all noted in ADR-007):
- Drag enters as an exogenous per-node acceleration profile computed from
  the previous plan (or a ballistic estimate on the first call) — the
  caller supplies it; the SOCP treats it as known.
- Free final time is handled OUTSIDE the SOCP: a coarse sweep on the first
  solve, then local refinement around the previous t_f on re-plans.
- Tower keep-out: one tilted half-space applied to the final quarter of
  the horizon (guards the tower body band y ∈ [91, 146] with ≥ 11 m at
  tower top while keeping the terminal slot feasible). Full obstacle
  avoidance is nonconvex and out of scope for v1 (SLS-27 benchmarks own
  validating this approximation against the sim's collision detector).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import cvxpy as cp
import numpy as np

# ---------------------------------------------------------------------------
# Horizon + geometry constants (mirrors packages/physics — keep in sync).
# ---------------------------------------------------------------------------

N = 60
"""Trajectory nodes (N intervals, N+1 states)."""

G = 9.80665
SLOT_CENTRE = np.array([8.5, 91.0, 0.0])
GLIDE_HALF_ANGLE_RAD = np.deg2rad(15.0)
POINTING_HALF_ANGLE_RAD = np.deg2rad(15.0)
TERMINAL_POS_TOL_M = 10.0
TERMINAL_VY_TOL_MPS = 5.0
TERMINAL_VH_TOL_MPS = 2.0
# Tower keep-out tilted plane: x >= KEEPOUT_X0 + KEEPOUT_SLOPE * (y - 91),
# applied to the last quarter of nodes. At the slot (y=91) the bound is
# 8.0 < 8.5 (terminal feasible); at tower top (y=146) it is 11.0 which
# clears the 6 m face + 4.5 m booster radius.
KEEPOUT_X0 = 8.0
KEEPOUT_SLOPE = (11.0 - KEEPOUT_X0) / (146.0 - 91.0)
KEEPOUT_FROM_NODE = 3 * N // 4

# Terminal-slack penalty: an infeasible MPC step is worse than a slightly
# violated terminal box (ticket note), so the box is soft with a steep cost.
TERMINAL_SLACK_WEIGHT = 1e4


@dataclass
class VehicleParams:
    """Per-vehicle constants the caller passes with each request."""

    dry_mass_kg: float
    max_thrust_n: float  # total, all engines that participate in descent
    min_thrust_n: float  # throttle floor × engines that stay lit
    isp_s: float
    # Body drag data for the coast propagator (SLS-47). Defaults match the
    # Super Heavy preset (packages/physics/src/scenarios.ts): radius 4.5 m,
    # subsonic plateau Cd 0.7.
    ref_area_m2: float = float(np.pi * 4.5 * 4.5)
    cd_subsonic: float = 0.7


@dataclass
class SolveInput:
    position: np.ndarray  # (3,) world frame, m
    velocity: np.ndarray  # (3,) m/s
    mass_kg: float
    vehicle: VehicleParams
    t_f_hint_s: float | None = None
    drag_accel: np.ndarray | None = None  # (N, 3) exogenous, m/s²
    # Remaining-coast hint (SLS-47): re-plans search only a narrow window
    # around the client's committed ignition epoch so it cannot churn.
    coast_hint_s: float | None = None


@dataclass
class SolveResult:
    status: str
    t_f_s: float = 0.0
    solve_time_ms: float = 0.0
    fuel_kg: float = 0.0
    # (N+1, 3) states / (N, 3) controls; empty on failure.
    positions: np.ndarray = field(default_factory=lambda: np.zeros((0, 3)))
    velocities: np.ndarray = field(default_factory=lambda: np.zeros((0, 3)))
    thrust_accel: np.ndarray = field(default_factory=lambda: np.zeros((0, 3)))
    throttle: np.ndarray = field(default_factory=lambda: np.zeros(0))
    terminal_slack: float = 0.0


# ---------------------------------------------------------------------------
# Parametric problem, built once.
# ---------------------------------------------------------------------------


class _ParametricPDG:
    def __init__(self) -> None:
        n = N
        # Variables.
        self.r = cp.Variable((n + 1, 3), name="r")
        self.v = cp.Variable((n + 1, 3), name="v")
        self.z = cp.Variable(n + 1, name="z")  # ln(mass)
        self.u = cp.Variable((n, 3), name="u")  # thrust accel, m/s²
        self.sigma = cp.Variable(n, name="sigma")  # ‖u‖ slack
        self.s_pos = cp.Variable(nonneg=True, name="s_pos")
        self.s_vel = cp.Variable(nonneg=True, name="s_vel")

        # Parameters (stamped per call). Every expression must stay DPP —
        # parameter×variable is fine, parameter×parameter is not — so all
        # products of call-time scalars (dt·α, dt·drag, ρ/m̄, …) are
        # pre-multiplied host-side into single parameters.
        self.p_dt = cp.Parameter(nonneg=True, name="dt")
        self.p_dt2_half = cp.Parameter(nonneg=True, name="dt2_half")
        self.p_dt_alpha = cp.Parameter(nonneg=True, name="dt_alpha")
        self.p_r0 = cp.Parameter(3, name="r0")
        self.p_v0 = cp.Parameter(3, name="v0")
        self.p_z0 = cp.Parameter(name="z0")
        # Minimum final log-mass: ln(dry mass + reserve).
        self.p_z_min = cp.Parameter(name="z_min")
        # Mass-normalized thrust bounds per node: ρ/m̄_k (Açıkmese
        # first-order linearization, computed host-side).
        self.p_sigma_lo = cp.Parameter(n, nonneg=True, name="sigma_lo")
        self.p_sigma_hi = cp.Parameter(n, nonneg=True, name="sigma_hi")
        # dt·(g + a_drag,k) and ½dt²·(g + a_drag,k), pre-multiplied.
        self.p_dt_acc_ext = cp.Parameter((n, 3), name="dt_acc_ext")
        self.p_dt2h_acc_ext = cp.Parameter((n, 3), name="dt2h_acc_ext")

        cons: list[cp.Constraint] = [
            self.r[0] == self.p_r0,
            self.v[0] == self.p_v0,
            self.z[0] == self.p_z0,
        ]
        for k in range(n):
            cons += [
                self.v[k + 1]
                == self.v[k] + self.p_dt * self.u[k] + self.p_dt_acc_ext[k],
                self.r[k + 1]
                == self.r[k]
                + self.p_dt * self.v[k]
                + self.p_dt2_half * self.u[k]
                + self.p_dt2h_acc_ext[k],
                self.z[k + 1] == self.z[k] - self.p_dt_alpha * self.sigma[k],
                # ‖u‖ ≤ σ (lossless relaxation).
                cp.norm(self.u[k]) <= self.sigma[k],
                # Pointing cone: u_y ≥ σ·cos(θ).
                self.u[k, 1] >= float(np.cos(POINTING_HALF_ANGLE_RAD)) * self.sigma[k],
                self.sigma[k] >= self.p_sigma_lo[k],
                self.sigma[k] <= self.p_sigma_hi[k],
            ]

        # Glide-slope cone (apex at slot centre) + tower keep-out plane on
        # the final quarter of the horizon.
        tan_gs = float(np.tan(GLIDE_HALF_ANGLE_RAD))
        for k in range(KEEPOUT_FROM_NODE, n + 1):
            cons += [
                cp.norm(self.r[k, [0, 2]] - SLOT_CENTRE[[0, 2]])
                <= tan_gs * (self.r[k, 1] - SLOT_CENTRE[1]) + TERMINAL_POS_TOL_M,
                self.r[k, 0]
                >= KEEPOUT_X0 + KEEPOUT_SLOPE * (self.r[k, 1] - SLOT_CENTRE[1]),
            ]

        # Soft terminal box (slack-penalized; infeasible > slightly violated).
        cons += [
            cp.norm(self.r[n] - SLOT_CENTRE) <= TERMINAL_POS_TOL_M + self.s_pos,
            cp.abs(self.v[n, 1]) <= TERMINAL_VY_TOL_MPS + self.s_vel,
            cp.norm(self.v[n, [0, 2]]) <= TERMINAL_VH_TOL_MPS + self.s_vel,
            self.v[n, 1] <= 0,
            # Fuel budget: the plan may not burn below dry mass (+ reserve).
            # Without this the min-fuel objective merely discourages — and a
            # high-altitude "optimal" plan can spend 300 t the tank doesn't
            # have (found by the SLS-27 bench: the tracked plan drained the
            # vehicle at t≈30 s and free-fell 70 km off target).
            self.z[n] >= self.p_z_min,
        ]

        # Min fuel = max final mass ≙ min Σσ·dt, plus slack penalties.
        objective = cp.Minimize(
            self.p_dt * cp.sum(self.sigma)
            + TERMINAL_SLACK_WEIGHT * (self.s_pos + self.s_vel)
        )
        # Kept on the instance so subclasses (SCvx trust-region variant in
        # scvx.py) can extend the constraint set and rebuild the problem.
        self.base_constraints = cons
        self.objective = objective
        self.problem = cp.Problem(objective, cons)

    def stamp_and_solve(self, inp: SolveInput, t_f: float) -> SolveResult:
        n = N
        dt = t_f / n
        m0 = inp.mass_kg
        veh = inp.vehicle
        alpha = 1.0 / (veh.isp_s * G)

        # Mass reference trajectory: burn at ~55 % max thrust (nominal
        # descent burn), floored at dry mass. Good enough for the
        # first-order thrust-bound linearization.
        mdot_ref = 0.55 * veh.max_thrust_n / (veh.isp_s * G)
        t_grid = dt * np.arange(n)
        m_ref = np.maximum(m0 - mdot_ref * t_grid, veh.dry_mass_kg)

        drag = inp.drag_accel if inp.drag_accel is not None else np.zeros((n, 3))
        acc_ext = drag + np.array([0.0, -G, 0.0])

        self.p_dt.value = dt
        self.p_dt2_half.value = 0.5 * dt * dt
        self.p_dt_alpha.value = dt * alpha
        self.p_r0.value = inp.position
        self.p_v0.value = inp.velocity
        self.p_z0.value = float(np.log(m0))
        # 2 % of the available propellant held as reserve; never above m0.
        reserve = 0.02 * max(m0 - veh.dry_mass_kg, 0.0)
        self.p_z_min.value = float(np.log(min(veh.dry_mass_kg + reserve, m0)))
        self.p_sigma_lo.value = veh.min_thrust_n / m_ref
        self.p_sigma_hi.value = veh.max_thrust_n / m_ref
        self.p_dt_acc_ext.value = dt * acc_ext
        self.p_dt2h_acc_ext.value = 0.5 * dt * dt * acc_ext

        t0 = time.perf_counter()
        try:
            self.problem.solve(solver=cp.CLARABEL, ignore_dpp=False)
        except (cp.SolverError, Exception):  # noqa: BLE001 — fall back hard
            try:
                self.problem.solve(solver=cp.ECOS)
            except Exception:
                return SolveResult(status="solver_error")
        ms = (time.perf_counter() - t0) * 1e3

        if self.problem.status not in ("optimal", "optimal_inaccurate"):
            return SolveResult(status=self.problem.status, solve_time_ms=ms)

        z_val = np.asarray(self.z.value)
        fuel = m0 - float(np.exp(z_val[-1]))
        sigma_val = np.asarray(self.sigma.value)
        # Throttle: σ·m / T_max per node (mass from the z trajectory).
        m_traj = np.exp(z_val[:-1])
        throttle = sigma_val * m_traj / veh.max_thrust_n
        return SolveResult(
            status="optimal",
            t_f_s=t_f,
            solve_time_ms=ms,
            fuel_kg=fuel,
            positions=np.asarray(self.r.value),
            velocities=np.asarray(self.v.value),
            thrust_accel=np.asarray(self.u.value),
            throttle=throttle,
            terminal_slack=float(self.s_pos.value + self.s_vel.value),
        )


_PDG = _ParametricPDG()


def _t_f_bounds(inp: SolveInput) -> tuple[float, float]:
    """Coarse physical bracket for the time of flight."""
    fall_h = max(inp.position[1] - SLOT_CENTRE[1], 1.0)
    vy_down = max(-inp.velocity[1], 1.0)
    # Lower: can't get there faster than a constant-current-speed fall.
    lo = max(fall_h / max(vy_down, 50.0), 2.0)
    # Upper: leisurely profile with heavy deceleration margin.
    hi = max(3.0 * np.sqrt(2.0 * fall_h / G), lo * 1.5, 20.0)
    return lo, hi


# A plan whose terminal box needed more slack than this is not a usable
# descent solution (mirrors the client-side gate in mpcController.ts).
USABLE_TERMINAL_SLACK = 5.0


def _sweep(inp: SolveInput, candidates: list[float]) -> tuple[SolveResult, float]:
    best: SolveResult = SolveResult(status="infeasible")
    total_ms = 0.0
    for t_f in candidates:
        res = _PDG.stamp_and_solve(inp, float(t_f))
        total_ms += res.solve_time_ms
        if res.status == "optimal":
            better = best.status != "optimal" or (
                res.fuel_kg + TERMINAL_SLACK_WEIGHT * res.terminal_slack
                < best.fuel_kg + TERMINAL_SLACK_WEIGHT * best.terminal_slack
            )
            if better:
                best = res
    return best, total_ms


def solve_pdg(inp: SolveInput) -> SolveResult:
    """Solve the descent, sweeping/refining t_f outside the SOCP."""
    total_ms = 0.0
    best: SolveResult = SolveResult(status="infeasible")
    if inp.t_f_hint_s is not None and inp.t_f_hint_s > 1.0:
        # Warm re-plan: local 3-point refinement around the hint.
        best, ms = _sweep(inp, [inp.t_f_hint_s * f for f in (0.92, 1.0, 1.08)])
        total_ms += ms
    # Cold sweep when there is no hint — or when the hinted solves came
    # back unusable (a stale hint must not trap the search: the client
    # would otherwise keep tracking an old plan while every re-plan around
    # the dead hint fails).
    if best.status != "optimal" or best.terminal_slack > USABLE_TERMINAL_SLACK:
        lo, hi = _t_f_bounds(inp)
        cold, ms = _sweep(inp, list(np.geomspace(lo, hi, 6)))
        total_ms += ms
        if cold.status == "optimal" and (
            best.status != "optimal"
            or cold.fuel_kg + TERMINAL_SLACK_WEIGHT * cold.terminal_slack
            < best.fuel_kg + TERMINAL_SLACK_WEIGHT * best.terminal_slack
        ):
            best = cold
    best.solve_time_ms = total_ms
    return best
