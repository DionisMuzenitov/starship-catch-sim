"""Drag + atmosphere model, ported from packages/physics (SLS-27).

This is a numpy port of the exact model the simulator integrates so the
SCvx drag-relinearization sees the same forces the sim will apply:

- ``packages/physics/src/atmosphere.ts`` — exponential density
  (RHO0 = 1.225, H_RHO = 8500) + ISA layer temperatures for the speed of
  sound.
- ``packages/physics/src/drag.ts`` — Mach-dependent Cd multiplier table
  (``CD_MACH_TABLE``) with smoothstep interpolation on a subsonic plateau.

KEEP THE TABLES VERBATIM IN SYNC with the TS source. Any change to the TS
breakpoints must be mirrored here (and vice versa) — numpy↔TS parity is
tracked as R1 / SLS-28.
"""

from __future__ import annotations

import numpy as np

# --- atmosphere.ts ---------------------------------------------------------

RHO0 = 1.225
"""Sea-level air density (kg/m³)."""

H_RHO = 8_500.0
"""Scale height for density (m)."""

GAMMA_AIR = 1.4
R_AIR = 287.05

# ISA layers: [base altitude m, base temperature K, lapse rate K/m].
# Verbatim from packages/physics/src/atmosphere.ts (ISA_LAYERS).
ISA_LAYERS: tuple[tuple[float, float, float], ...] = (
    (0.0, 288.15, -0.0065),
    (11_000.0, 216.65, 0.0),
    (20_000.0, 216.65, 0.001),
    (32_000.0, 228.65, 0.0028),
    (47_000.0, 270.65, 0.0),
    (51_000.0, 270.65, -0.0028),
    (71_000.0, 214.65, -0.002),
    (84_852.0, 186.946, 0.0),
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

# [Mach, Cd multiplier on the subsonic plateau] — Mach-ascending.
# Verbatim from packages/physics/src/drag.ts (CD_MACH_TABLE).
CD_MACH_TABLE: tuple[tuple[float, float], ...] = (
    (0.0, 1.0),
    (0.6, 1.0),
    (0.9, 1.25),
    (1.1, 1.55),
    (1.5, 1.8),
    (2.0, 1.78),
    (3.0, 1.6),
    (5.0, 1.5),
)


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
