"""Coast-phase ignition planning (SLS-47).

The thrust floor makes burn-only plans infeasible from high altitude: the
engines cannot burn gently enough for a 200 s+ descent, so `solve_pdg`
returns nothing usable until mid-fall — and by then the lateral divert
budget is spent (SLS-27/SLS-48 findings). This module plans from a FUTURE
ignition point instead, mirroring both real Super Heavy operations
(boostback → unpowered coast under grid-fin steering → landing burn) and
G-FOLD practice (guidance solves from ignition; picking the ignition time
is an outer loop):

1. Propagate the current state ballistically — gravity + the same Cd(M)
   drag model the simulator integrates (`aero.py`) — storing samples.
2. Sweep candidate coast durations t_c over that table, solving the burn
   SOCP from each propagated state (fast LINEAR solves for the search).
3. Refine around the best candidate, then polish the winner with SCvx
   (drag-relinearized burn) — the plan the client actually tracks.

v1 scope note: the coast is planned as PURELY ballistic. Grid fins hold
attitude during coast (client-side) but planned fin-steered divert is out
of scope — the win here is that the burn starts inside its feasible
window with full thrust authority and fuel for the divert.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from .aero import drag_accel_at
from .problem import (
    G,
    SLOT_CENTRE,
    SolveInput,
    USABLE_TERMINAL_SLACK,
    VehicleParams,
    solve_pdg,
)
from .scvx import SCvxResult, solve_scvx

COAST_DT_S = 0.5
"""Propagation step (semi-implicit Euler; drag varies slowly at 2 Hz)."""

MIN_IGNITION_ALTITUDE_M = 2_000.0
"""Don't plan ignitions below this height above the slot — there is no
suicide-burn margin left underneath."""

MAX_COAST_S = 300.0
COARSE_CANDIDATES = 8
REFINE_ROUNDS = 2

FUEL_TIE_TOL = 0.015
"""Candidates within this relative fuel margin of the best count as ties;
the EARLIEST ignition among them wins (see selection-rule note below)."""

HINT_WINDOW_S = 5.0
"""Half-width of the ignition search window around a client coast hint."""


@dataclass
class CoastBurnResult:
    status: str
    ignition_time_s: float = 0.0
    solve_time_ms: float = 0.0
    # Coast samples (decimated for the wire), node 0 = request state.
    coast_positions: np.ndarray = field(default_factory=lambda: np.zeros((0, 3)))
    coast_velocities: np.ndarray = field(default_factory=lambda: np.zeros((0, 3)))
    # Burn plan from the ignition state (SCvx-polished).
    burn: SCvxResult = field(default_factory=lambda: SCvxResult(status="none"))


def propagate_ballistic(
    position: np.ndarray,
    velocity: np.ndarray,
    mass_kg: float,
    vehicle: VehicleParams,
    max_s: float = MAX_COAST_S,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Ballistic coast table: (times, positions, velocities) at COAST_DT_S.

    Stops at `max_s` or when altitude drops below the minimum ignition
    height. Mass is constant (engines off).
    """
    g_vec = np.array([0.0, -G, 0.0])
    times = [0.0]
    positions = [position.astype(float).copy()]
    velocities = [velocity.astype(float).copy()]
    r = position.astype(float).copy()
    v = velocity.astype(float).copy()
    t = 0.0
    floor_y = SLOT_CENTRE[1] + MIN_IGNITION_ALTITUDE_M
    while t < max_s and r[1] > floor_y:
        a = g_vec + drag_accel_at(
            v, r[1], mass_kg, vehicle.ref_area_m2, vehicle.cd_subsonic
        )
        v = v + COAST_DT_S * a
        r = r + COAST_DT_S * v
        t += COAST_DT_S
        times.append(t)
        positions.append(r.copy())
        velocities.append(v.copy())
    return np.array(times), np.array(positions), np.array(velocities)


def _burn_input(
    inp: SolveInput, r: np.ndarray, v: np.ndarray, t_f_hint: float | None
) -> SolveInput:
    return SolveInput(
        position=r,
        velocity=v,
        mass_kg=inp.mass_kg,  # engines off during coast
        vehicle=inp.vehicle,
        t_f_hint_s=t_f_hint,
    )


def _usable(res) -> bool:  # noqa: ANN001 — SolveResult | SCvxResult
    return res.status == "optimal" and res.terminal_slack <= USABLE_TERMINAL_SLACK


def solve_coast_burn(inp: SolveInput) -> CoastBurnResult:
    """Outer search over coast duration, then SCvx-polish the winner."""
    t0 = time.perf_counter()
    times, rs, vs = propagate_ballistic(
        inp.position, inp.velocity, inp.mass_kg, inp.vehicle
    )
    n_table = len(times)

    def state_at(tc: float) -> tuple[np.ndarray, np.ndarray]:
        k = min(int(round(tc / COAST_DT_S)), n_table - 1)
        return rs[k], vs[k]

    # Sweep (linear solves — milliseconds each after DPP warmup).
    #
    # Two stabilizers against ignition-time churn (SLS-47 probe measured
    # re-plans re-picking ignition anywhere in 0–60 s, with the vehicle
    # flip-flopping coast/burn and eventually panic-burning):
    #
    # 1. Fuel is nearly FLAT in t_c (gravity losses dominate), so a pure
    #    argmin jitters. Among candidates within FUEL_TIE_TOL of the best
    #    we pick the EARLIEST ignition — longer, gentler burns leave the
    #    tracker more correction margin, and the choice is stable.
    # 2. When the client sends `coast_hint_s` (its committed remaining
    #    coast), the search is confined to ±HINT_WINDOW_S around it: a
    #    re-plan REFINES the committed epoch, it never re-opens the whole
    #    question. Falls back to the full sweep if the window is dry.
    t_max = float(times[-1])
    usable: list[tuple[float, float]] = []  # (t_c, fuel)
    burn_hint: float | None = None

    def select() -> float | None:
        if not usable:
            return None
        fuel_floor = min(f for _, f in usable)
        return min(tc for tc, f in usable if f <= fuel_floor * (1 + FUEL_TIE_TOL))

    def sweep(cands: list[float], rounds: int) -> None:
        nonlocal burn_hint
        candidates = cands
        for _ in range(1 + rounds):
            for tc in candidates:
                r, v = state_at(tc)
                res = solve_pdg(_burn_input(inp, r, v, burn_hint))
                if _usable(res):
                    usable.append((tc, res.fuel_kg))
                    burn_hint = res.t_f_s
            incumbent = select()
            if incumbent is None or len(candidates) < 2:
                break
            span = candidates[1] - candidates[0]
            lo = max(0.0, incumbent - span)
            hi = min(t_max, incumbent + span)
            candidates = list(np.linspace(lo, hi, 5))

    hint = inp.coast_hint_s
    if hint is not None and hint >= 0:
        lo = max(0.0, min(hint - HINT_WINDOW_S, t_max))
        hi = max(0.0, min(hint + HINT_WINDOW_S, t_max))
        sweep(list(np.linspace(lo, hi, 5)), rounds=0)
    if not usable:
        sweep(
            list(np.linspace(0.0, t_max, min(COARSE_CANDIDATES, n_table))),
            rounds=REFINE_ROUNDS,
        )

    best_tc = select()
    if best_tc is None:
        return CoastBurnResult(
            status="infeasible",
            solve_time_ms=(time.perf_counter() - t0) * 1e3,
        )

    # SCvx polish at the winning ignition point — this is the tracked plan.
    r_ign, v_ign = state_at(best_tc)
    burn = solve_scvx(_burn_input(inp, r_ign, v_ign, burn_hint))
    if not _usable(burn):
        # SCvx drag correction can push a marginal linear plan out of the
        # usable band; fall back to reporting infeasible rather than
        # shipping a plan the client would rightly reject.
        return CoastBurnResult(
            status="infeasible",
            solve_time_ms=(time.perf_counter() - t0) * 1e3,
        )

    # Decimate the coast table for the wire: ~1 sample / 2 s, always
    # including the ignition state as the LAST sample.
    k_ign = min(int(round(best_tc / COAST_DT_S)), n_table - 1)
    stride = max(1, int(round(2.0 / COAST_DT_S)))
    idx = list(range(0, k_ign, stride)) + [k_ign]
    return CoastBurnResult(
        status="optimal",
        ignition_time_s=float(times[k_ign]),
        solve_time_ms=(time.perf_counter() - t0) * 1e3,
        coast_positions=rs[idx],
        coast_velocities=vs[idx],
        burn=burn,
    )
