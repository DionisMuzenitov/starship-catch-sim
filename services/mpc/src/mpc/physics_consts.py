"""Single-sourced physics constants for the MPC service (SLS-28 / R1).

Loads the generated ``rl_consts.json`` — the ONE source of truth emitted from
the TypeScript physics core by ``tools/gen-physics-consts.ts`` — so the MPC
service can no longer drift from the simulator it plans against. This replaces
the hand-copied "KEEP THE TABLES VERBATIM IN SYNC" tables that previously lived
in ``aero.py`` (and had already drifted across the test files: Isp 340 vs 327).

The file is generated + committed; a CI check (``pnpm gen:consts:check``) fails
if it is stale, so editing a TS constant without regenerating breaks the build.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np

# services/mpc/src/mpc/physics_consts.py -> parents[3] == services/
_CONSTS_PATH = Path(__file__).resolve().parents[3] / "rl" / "rl_consts.json"


@lru_cache(maxsize=1)
def _consts() -> dict:
    with _CONSTS_PATH.open() as fh:
        return json.load(fh)


# --- atmosphere (mirrors packages/physics/src/atmosphere.ts) ---------------
_atm = _consts()["atmosphere"]
RHO0: float = float(_atm["rho0"])
P0: float = float(_atm["p0"])
H_RHO: float = float(_atm["hRho"])
H_P: float = float(_atm["hP"])
GAMMA_AIR: float = float(_atm["gammaAir"])
R_AIR: float = float(_atm["rAir"])
ISA_LAYERS: tuple[tuple[float, float, float], ...] = tuple(
    (float(base), float(t0), float(lapse))
    for base, t0, lapse in _atm["isaLayers"]
)

# --- drag Cd(M) table (mirrors packages/physics/src/drag.ts) ---------------
CD_MACH_TABLE: tuple[tuple[float, float], ...] = tuple(
    (float(m), float(mult)) for m, mult in _consts()["dragCdMachTable"]
)

# --- booster body-drag geometry (mirrors scenarios.ts BoosterVehicle) ------
_booster = _consts()["vehicles"]["booster"]
BOOSTER_REF_AREA_M2: float = float(_booster["bodyRefArea"])
BOOSTER_CD_SUBSONIC: float = float(_booster["bodyCd"])

G0: float = float(_consts()["g0"])


def _sea_level_raptor() -> dict:
    """Canonical sea-level Raptor params from the shared constants (the first
    gimballing centre engine). The MPC's reduced model aggregates these over
    the participating engine count; single-sourcing the per-engine numbers
    kills the 340-vs-327 Isp drift between the test files."""
    for eng in _booster["engines"]:
        if eng["canGimbal"]:
            return eng
    return _booster["engines"][0]


_raptor = _sea_level_raptor()
RAPTOR_SEA_THRUST_N: float = float(_raptor["thrustSea"])
RAPTOR_SEA_ISP_S: float = float(_raptor["ispSea"])


def isa_layers_array() -> np.ndarray:
    """ISA layers as an (N, 3) float64 array."""
    return np.array(ISA_LAYERS, dtype=np.float64)
