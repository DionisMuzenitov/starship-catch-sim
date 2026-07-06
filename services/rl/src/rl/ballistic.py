"""Ballistic start-state sampler for the altitude curriculum (SLS-29).

The full booster descent is ~240 s / ~6000 control steps, mostly unpowered
coast — episodes that long dilute the terminal-catch learning signal
(SLS-47's central finding: the catch is the hard part). The curriculum
therefore starts episodes PART-WAY down a nominal engines-off descent and
expands the start-altitude band upward as the policy improves.

To keep starts dynamically consistent (not teleported), we integrate ONE
nominal engines-off, fins-neutral, calm-wind trajectory from the scenario IC
to near-ground, cache states along it, and sample episode starts from that
table. Costs ~10 s once per process; cached per scenario id.
"""

from __future__ import annotations

import numpy as np

from . import consts as C
from .physics_np import ControlInput, World, initial_world, sim_step

_GRAVITY = 9.80665

# altitude -> cached World snapshots, built lazily per scenario.
_CACHE: dict[str, list[World]] = {}

_SAMPLE_EVERY_S = 1.0  # snapshot cadence along the nominal descent


def _neutral_control(vehicle: C.Vehicle) -> ControlInput:
    n_fins = sum(1 for s in vehicle.surfaces if s.kind == "grid_fin")
    n_flaps = sum(1 for s in vehicle.surfaces if s.kind == "flap")
    return ControlInput(
        engine_groups={g: 0.0 for g in ("centre", "inner", "outer", "ship")},
        engines_on={g: False for g in ("centre", "inner", "outer", "ship")},
        fins=np.zeros(n_fins),
        flaps=np.zeros(n_flaps),
    )


def _copy_world(w: World) -> World:
    return World(
        position=w.position.copy(),
        velocity=w.velocity.copy(),
        attitude=w.attitude.copy(),
        angular_velocity=w.angular_velocity.copy(),
        mass=w.mass,
        inertia=w.inertia.copy(),
        engine_states=w.engine_states.copy(),
        surface_states=w.surface_states.copy(),
        propellant_mass=w.propellant_mass,
        t=w.t,
    )


def nominal_descent(scenario_id: str) -> list[World]:
    """Cached engines-off nominal descent, one snapshot per second of fall."""
    if scenario_id in _CACHE:
        return _CACHE[scenario_id]
    sc = C.SCENARIOS[scenario_id]
    vehicle = C.VEHICLES[sc.vehicle]
    control = _neutral_control(vehicle)
    dt = C.PHYSICS_DT
    per_snapshot = max(1, round(_SAMPLE_EVERY_S / dt))

    world = initial_world(scenario_id)
    snapshots = [_copy_world(world)]
    # 400 s hard cap; stop just above the ground.
    for _ in range(int(400.0 / _SAMPLE_EVERY_S)):
        for _ in range(per_snapshot):
            world = sim_step(world, vehicle, control, dt, _GRAVITY)
            if world.position[1] <= 500.0:
                break
        snapshots.append(_copy_world(world))
        if world.position[1] <= 500.0:
            break
    _CACHE[scenario_id] = snapshots
    return snapshots


def sample_start(
    scenario_id: str,
    alt_range: tuple[float, float],
    rng: np.random.Generator,
) -> World:
    """A dynamically-consistent start state with altitude uniform in
    `alt_range`, drawn from the nominal descent (nearest cached snapshot).
    Episode clock restarts at t=0.

    NOTE: the nominal ballistic impact is deliberately ~800 m past the tower
    (SLS-49 safety offset), so ballistic starts always embed an ~800 m divert.
    Early curriculum stages must use `corridor_start` instead — a catchable
    approach corridor — or the first rung is unlearnably hard (SLS-29
    diagnostic: even a scripted vertical suicide-burn terminates ~790 m out).
    """
    snaps = nominal_descent(scenario_id)
    alts = np.array([s.position[1] for s in snaps])
    lo = max(float(alt_range[0]), float(alts.min()))
    hi = min(float(alt_range[1]), float(alts.max()))
    target = rng.uniform(lo, hi)
    idx = int(np.argmin(np.abs(alts - target)))
    w = _copy_world(snaps[idx])
    w.t = 0.0
    return w


def corridor_start(
    scenario_id: str,
    spec: dict,
    rng: np.random.Generator,
) -> World:
    """A synthetic-but-physical start inside the catchable approach corridor:
    above the catch point, small lateral offset, upright, descending. This is
    the state class MPC's dock phase reaches (ADR-009/010); RL learns the
    terminal envelope here before the curriculum expands to ballistic starts.

    spec keys (all optional): alt_above [lo,hi] m above the catch point,
    lateral max-radius m, vy [lo,hi] m/s (negative = down), vh max m/s,
    tilt max rad, omega max rad/s.
    """
    sc = C.SCENARIOS[scenario_id]
    veh = C.VEHICLES[sc.vehicle]
    alt_lo, alt_hi = spec.get("alt_above", (100.0, 600.0))
    lateral = float(spec.get("lateral", 150.0))
    vy_lo, vy_hi = spec.get("vy", (-60.0, -10.0))
    vh_max = float(spec.get("vh", 10.0))
    tilt_max = float(spec.get("tilt", 0.05))
    omega_max = float(spec.get("omega", 0.02))

    target = sc.target_position
    ang = rng.uniform(0, 2 * np.pi)
    r = lateral * np.sqrt(rng.uniform(0, 1))
    position = np.array(
        [
            target[0] + r * np.cos(ang),
            target[1] + rng.uniform(alt_lo, alt_hi),
            target[2] + r * np.sin(ang),
        ]
    )
    vh_ang = rng.uniform(0, 2 * np.pi)
    vh = rng.uniform(0, vh_max)
    velocity = np.array(
        [vh * np.cos(vh_ang), rng.uniform(vy_lo, vy_hi), vh * np.sin(vh_ang)]
    )
    # small random tilt about a random horizontal axis
    tilt = rng.uniform(0, tilt_max)
    ax_ang = rng.uniform(0, 2 * np.pi)
    axis = np.array([np.cos(ax_ang), 0.0, np.sin(ax_ang)])
    attitude = np.array(
        [*(axis * np.sin(tilt / 2)), np.cos(tilt / 2)], dtype=np.float64
    )
    omega = rng.uniform(-1, 1, 3) * omega_max

    from .physics_np import current_inertia, current_mass

    prop = sc.propellant_mass
    return World(
        position=position,
        velocity=velocity,
        attitude=attitude,
        angular_velocity=omega,
        mass=current_mass(veh.mass_props, prop),
        inertia=current_inertia(veh.mass_props, prop),
        engine_states=np.zeros((len(veh.engines), 4)),
        surface_states=np.zeros(len(veh.surfaces)),
        propellant_mass=prop,
        t=0.0,
    )


def start_from_spec(scenario_id: str, spec, rng: np.random.Generator) -> World:
    """Dispatch: tuple/list → ballistic band; dict kind=corridor → corridor;
    dict kind=ballistic → band from spec["alt"]."""
    if isinstance(spec, (tuple, list)):
        return sample_start(scenario_id, tuple(spec), rng)
    if isinstance(spec, dict):
        if spec.get("kind") == "corridor":
            return corridor_start(scenario_id, spec, rng)
        return sample_start(scenario_id, tuple(spec["alt"]), rng)
    raise ValueError(f"bad start spec: {spec!r}")
