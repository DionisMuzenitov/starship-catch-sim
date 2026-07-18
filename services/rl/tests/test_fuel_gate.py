"""SLS-78: engines produce no thrust once the propellant tank is empty.

Mirrors the TS invariant in packages/physics/src/world.test.ts so both ports of
the plant enforce the fuel gate identically (numpy↔TS parity, SLS-28).
"""

import dataclasses

import numpy as np
import rl.consts as C
from rl.physics_np import (
    ControlInput,
    current_inertia,
    current_mass,
    initial_world,
    sim_step,
)

DT = 1.0 / 250.0
BOOSTER = C.VEHICLES["booster"]

_FULL = ControlInput(
    engine_groups={"centre": 1.0, "inner": 1.0, "outer": 1.0, "ship": 0.0},
    engines_on={"centre": True, "inner": True, "outer": True, "ship": False},
)
_IDLE = ControlInput(
    engine_groups={"centre": 0.0, "inner": 0.0, "outer": 0.0, "ship": 0.0},
    engines_on={"centre": False, "inner": False, "outer": False, "ship": False},
)


def _with_propellant(world, prop: float):
    mp = BOOSTER.mass_props
    return dataclasses.replace(
        world,
        propellant_mass=prop,
        mass=current_mass(mp, prop),
        inertia=current_inertia(mp, prop),
    )


def test_empty_tank_matches_engines_off():
    base = initial_world("booster-descent-calm")
    dry = _with_propellant(base, 0.0)
    off = dry
    for _ in range(250):
        dry = sim_step(dry, BOOSTER, _FULL, DT, gravity=9.80665)  # commanded ON
        off = sim_step(off, BOOSTER, _IDLE, DT, gravity=9.80665)  # OFF
    # No propellant → full throttle is indistinguishable from never firing.
    assert abs(dry.velocity[1] - off.velocity[1]) < 1e-9
    assert abs(dry.position[1] - off.position[1]) < 1e-6
    assert dry.propellant_mass == 0.0
    assert abs(dry.mass - BOOSTER.mass_props.dry_mass) < 1e-6


def test_propellant_depletes_to_zero_then_thrust_cuts_off():
    world = _with_propellant(initial_world("booster-descent-calm"), 500.0)
    saw_empty = False
    for _ in range(2000):
        world = sim_step(world, BOOSTER, _FULL, DT, gravity=9.80665)
        assert world.propellant_mass >= 0.0  # never negative
        if world.propellant_mass == 0.0:
            saw_empty = True
            break
    assert saw_empty
    before = world.velocity[1]
    world = sim_step(world, BOOSTER, _FULL, DT, gravity=9.80665)
    assert world.propellant_mass == 0.0
    assert world.velocity[1] < before  # still falling: no thrust kick
