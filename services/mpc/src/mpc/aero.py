"""Drag + atmosphere model, ported from packages/physics (SLS-27).

This is a numpy port of the exact model the simulator integrates so the
SCvx drag-relinearization sees the same forces the sim will apply:

- ``packages/physics/src/atmosphere.ts`` — exponential density + ISA layer
  temperatures for the speed of sound.
- ``packages/physics/src/drag.ts`` — Mach-dependent Cd multiplier table
  (``CD_MACH_TABLE``) with smoothstep interpolation on a subsonic plateau.

SLS-28 / R1: the atmosphere + drag tables are no longer hand-copied — they are
loaded from the generated single-source ``rl_consts.json`` (see
``physics_consts.py``), so they cannot drift from the TS source. A CI check
(``pnpm gen:consts:check``) fails if the JSON is stale.
"""

from __future__ import annotations

import numpy as np

from .physics_consts import (
    CD_MACH_TABLE,
    GAMMA_AIR,
    H_RHO,
    ISA_LAYERS,
    R_AIR,
    RHO0,
)


def density_at(altitude_m: float) -> float:
    """Exponential-atmosphere density; mirrors ``densityAt`` (TS).

    Note the TS source returns RHO0 for negative altitudes.
    """
    if altitude_m < 0:
        return RHO0
    return RHO0 * float(np.exp(-altitude_m / H_RHO))


def temperature_at(altitude_m: float) -> float:
    """ISA layer temperature (K); mirrors ``temperatureAt`` (TS)."""
    h = max(0.0, altitude_m)
    base, t0, lapse = ISA_LAYERS[0]
    for cand in ISA_LAYERS:
        if cand[0] > h:
            break
        base, t0, lapse = cand
    return t0 + lapse * (h - base)


def speed_of_sound_at(altitude_m: float) -> float:
    """a = sqrt(γ·R·T(h)); mirrors ``speedOfSoundAt`` (TS)."""
    return float(np.sqrt(GAMMA_AIR * R_AIR * temperature_at(altitude_m)))


def mach_number(speed_mps: float, altitude_m: float) -> float:
    return speed_mps / speed_of_sound_at(altitude_m)


# --- drag.ts ---------------------------------------------------------------
# CD_MACH_TABLE is imported from physics_consts (single-sourced from the TS
# drag.ts via rl_consts.json) — see module docstring (SLS-28 / R1).


def _smoothstep(t: float) -> float:
    return t * t * (3.0 - 2.0 * t)


def cd_at(mach: float, cd_subsonic: float) -> float:
    """Mach-dependent drag coefficient; mirrors ``cdAt`` (TS)."""
    m = max(0.0, mach)
    last_m, last_mult = CD_MACH_TABLE[-1]
    if m >= last_m:
        return cd_subsonic * last_mult
    lo = CD_MACH_TABLE[0]
    hi = CD_MACH_TABLE[1]
    for i in range(1, len(CD_MACH_TABLE)):
        hi = CD_MACH_TABLE[i]
        if hi[0] > m:
            break
        lo = hi
    if hi[0] == lo[0]:
        return cd_subsonic * lo[1]
    t = _smoothstep((m - lo[0]) / (hi[0] - lo[0]))
    return cd_subsonic * (lo[1] + (hi[1] - lo[1]) * t)


def drag_accel_at(
    velocity: np.ndarray,
    altitude_m: float,
    mass_kg: float,
    ref_area_m2: float,
    cd_subsonic: float,
) -> np.ndarray:
    """Drag ACCELERATION (m/s², world frame) on the body.

    a_drag = −½ · ρ(h) · |v| · v · Cd(M) · A / m — mirrors
    ``bodyDragForce`` (TS) divided by mass. Wind-relative velocity is the
    caller's concern (the SCvx v1 linearizes about still air).
    """
    speed = float(np.linalg.norm(velocity))
    if speed == 0.0 or mass_kg <= 0.0:
        return np.zeros(3)
    rho = density_at(altitude_m)
    cd = cd_at(mach_number(speed, altitude_m), cd_subsonic)
    coeff = -0.5 * rho * speed * cd * ref_area_m2 / mass_kg
    return coeff * velocity


def drag_profile(
    positions: np.ndarray,
    velocities: np.ndarray,
    masses: np.ndarray,
    ref_area_m2: float,
    cd_subsonic: float,
) -> np.ndarray:
    """Per-interval drag-acceleration profile for the SOCP.

    Evaluates the drag model at each of the first N nodes of an (N+1)-node
    trajectory (interval k uses the state at its left node — consistent
    with the SOCP treating external acceleration as constant over dt).
    Returns an (N, 3) array.
    """
    n = len(positions) - 1
    out = np.zeros((n, 3))
    for k in range(n):
        out[k] = drag_accel_at(
            velocities[k],
            float(positions[k][1]),
            float(masses[k]),
            ref_area_m2,
            cd_subsonic,
        )
    return out
