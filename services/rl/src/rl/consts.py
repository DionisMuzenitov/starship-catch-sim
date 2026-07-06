"""Load the single-source physics constants (SLS-28 / R1).

`rl_consts.json` is generated from the TypeScript physics core by
`tools/gen-physics-consts.ts` and is the ONE source of truth — the numpy port
and the MPC service both consume it, so a constant cannot drift between the
languages. A CI check (`pnpm gen:consts:check`) fails if it is stale.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

# services/rl/src/rl/consts.py -> parents[2] == services/rl
_CONSTS_PATH = Path(__file__).resolve().parents[2] / "rl_consts.json"


@lru_cache(maxsize=1)
def _raw() -> dict:
    with _CONSTS_PATH.open() as fh:
        return json.load(fh)


_c = _raw()

PHYSICS_DT: float = float(_c["physicsDt"])
G0: float = float(_c["g0"])

_atm = _c["atmosphere"]
RHO0: float = float(_atm["rho0"])
P0: float = float(_atm["p0"])
H_RHO: float = float(_atm["hRho"])
H_P: float = float(_atm["hP"])
GAMMA_AIR: float = float(_atm["gammaAir"])
R_AIR: float = float(_atm["rAir"])
ISA_LAYERS: np.ndarray = np.array(_atm["isaLayers"], dtype=np.float64)  # (8, 3)
CD_MACH_TABLE: np.ndarray = np.array(_c["dragCdMachTable"], dtype=np.float64)  # (8, 2)


@dataclass(frozen=True)
class Engine:
    mount: np.ndarray
    direction: np.ndarray
    thrust_vac: float
    thrust_sea: float
    isp_vac: float
    isp_sea: float
    max_gimbal: float
    max_gimbal_rate: float
    min_throttle: float
    tau_throttle: float
    tau_gimbal: float
    can_gimbal: bool


@dataclass(frozen=True)
class Surface:
    kind: str
    mount: np.ndarray
    hinge_axis: np.ndarray
    zero_defl_normal: np.ndarray
    area: float
    cl_alpha: float
    cd0: float
    max_deflection: float
    max_deflection_rate: float
    alpha_stall: float
    tau: float


@dataclass(frozen=True)
class MassProps:
    dry_mass: float
    propellant_mass: float
    dry_com: np.ndarray
    dry_inertia: np.ndarray  # (9,)
    tank_bottom: float
    tank_top: float
    tank_radius: float
    propellant_density: float


@dataclass(frozen=True)
class Vehicle:
    name: str
    engines: tuple[Engine, ...]
    engine_group_of: tuple[str, ...]
    surfaces: tuple[Surface, ...]
    surface_ctl_index_of: tuple[int, ...]
    body_ref_area: float
    body_cd: float
    mass_props: MassProps  # dry template; propellant tracked on the World


@dataclass(frozen=True)
class Scenario:
    id: str
    vehicle: str
    gravity: float
    # Full initial world, straight from the serialized TS World.
    position: np.ndarray
    velocity: np.ndarray
    attitude: np.ndarray
    angular_velocity: np.ndarray
    mass: float
    inertia: np.ndarray  # (9,)
    propellant_mass: float
    target_position: np.ndarray
    position_tol_m: float
    vertical_speed_tol_mps: float
    horizontal_speed_tol_mps: float
    attitude_tilt_tol_rad: float
    angular_rate_tol_rad_per_s: float
    # Raw wind spec from the generated JSON (kind/layers/dryden) — consumed by
    # rl.wind_np.build_wind (SLS-29). Distribution mirror, not parity-gated.
    wind_spec: dict | None = None


def _v(a) -> np.ndarray:
    return np.array(a, dtype=np.float64)


def _engine(d: dict) -> Engine:
    return Engine(
        mount=_v(d["mount"]),
        direction=_v(d["direction"]),
        thrust_vac=float(d["thrustVac"]),
        thrust_sea=float(d["thrustSea"]),
        isp_vac=float(d["ispVac"]),
        isp_sea=float(d["ispSea"]),
        max_gimbal=float(d["maxGimbal"]),
        max_gimbal_rate=float(d["maxGimbalRate"]),
        min_throttle=float(d["minThrottle"]),
        tau_throttle=float(d["tauThrottle"]),
        tau_gimbal=float(d["tauGimbal"]),
        can_gimbal=bool(d["canGimbal"]),
    )


def _surface(d: dict) -> Surface:
    return Surface(
        kind=d["kind"],
        mount=_v(d["mount"]),
        hinge_axis=_v(d["hingeAxisBody"]),
        zero_defl_normal=_v(d["zeroDeflectionNormalBody"]),
        area=float(d["area"]),
        cl_alpha=float(d["clAlpha"]),
        cd0=float(d["cd0"]),
        max_deflection=float(d["maxDeflection"]),
        max_deflection_rate=float(d["maxDeflectionRate"]),
        alpha_stall=float(d["alphaStall"]),
        tau=float(d["tau"]),
    )


def _mass(d: dict) -> MassProps:
    return MassProps(
        dry_mass=float(d["dryMass"]),
        propellant_mass=float(d["propellantMass"]),
        dry_com=_v(d["dryCoM"]),
        dry_inertia=_v(d["dryInertia"]),
        tank_bottom=float(d["tankBottom"]),
        tank_top=float(d["tankTop"]),
        tank_radius=float(d["tankRadius"]),
        propellant_density=float(d["propellantDensity"]),
    )


def _vehicle(name: str, d: dict) -> Vehicle:
    return Vehicle(
        name=name,
        engines=tuple(_engine(e) for e in d["engines"]),
        engine_group_of=tuple(d["engineGroupOf"]),
        surfaces=tuple(_surface(s) for s in d["surfaces"]),
        surface_ctl_index_of=tuple(int(i) for i in d["surfaceCtlIndexOf"]),
        body_ref_area=float(d["bodyRefArea"]),
        body_cd=float(d["bodyCd"]),
        mass_props=_mass(d["massProps"]) if "massProps" in d else None,  # set below
    )


# Vehicles — attach the correct dry mass template per vehicle.
_MASS_BY_VEHICLE = {
    "booster": _mass(_c["massPresets"]["superHeavy"]),
    "ship": _mass(_c["massPresets"]["starship"]),
}


def _build_vehicle(name: str) -> Vehicle:
    d = _c["vehicles"][name]
    base = _vehicle(name, d)
    return Vehicle(
        name=base.name,
        engines=base.engines,
        engine_group_of=base.engine_group_of,
        surfaces=base.surfaces,
        surface_ctl_index_of=base.surface_ctl_index_of,
        body_ref_area=base.body_ref_area,
        body_cd=base.body_cd,
        mass_props=_MASS_BY_VEHICLE[name],
    )


VEHICLES: dict[str, Vehicle] = {
    "booster": _build_vehicle("booster"),
    "ship": _build_vehicle("ship"),
}


def _scenario(d: dict) -> Scenario:
    rb = d["initialWorld"]["rigidBody"]
    tc = d["targetCatch"]
    return Scenario(
        id=d["id"],
        vehicle=d["vehicle"],
        gravity=float(d["env"]["gravity"]),
        position=_v(rb["position"]),
        velocity=_v(rb["velocity"]),
        attitude=_v(rb["attitude"]),
        angular_velocity=_v(rb["angularVelocity"]),
        mass=float(rb["mass"]),
        inertia=_v(rb["inertia"]),
        propellant_mass=float(d["initialWorld"]["mass"]["propellantMass"]),
        target_position=_v(tc["targetPosition"]),
        position_tol_m=float(tc["positionTolM"]),
        vertical_speed_tol_mps=float(tc["verticalSpeedTolMps"]),
        horizontal_speed_tol_mps=float(tc["horizontalSpeedTolMps"]),
        attitude_tilt_tol_rad=float(tc["attitudeTiltTolRad"]),
        angular_rate_tol_rad_per_s=float(tc["angularRateTolRadPerS"]),
        wind_spec=d["env"]["wind"],
    )


SCENARIOS: dict[str, Scenario] = {s["id"]: _scenario(s) for s in _c["scenarios"]}


@dataclass(frozen=True)
class Aabb:
    center: np.ndarray
    half_extents: np.ndarray

    def contains(self, p: np.ndarray) -> bool:
        return bool(np.all(np.abs(p - self.center) <= self.half_extents))


_tower = _c["tower"]
CAPTURE_VOLUME = Aabb(
    center=_v(_tower["captureVolume"]["center"]),
    half_extents=_v(_tower["captureVolume"]["halfExtents"]),
)
TOWER_STRUCTURE = Aabb(
    center=_v(_tower["structureAabb"]["center"]),
    half_extents=_v(_tower["structureAabb"]["halfExtents"]),
)
