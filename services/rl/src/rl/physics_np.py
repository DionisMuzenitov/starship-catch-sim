"""Numpy port of the TS physics core (SLS-28 / R1).

Faithful float64 reimplementation of packages/physics `simStep` and every
subsystem it calls — integrator (RK4), thrust plant, aero surfaces, mass
model, atmosphere, drag. Equations, constants, and operation order mirror the
TS so a 1-second rollout matches to < 1e-4 (verified by tests/test_equivalence).

Public surface (kept STABLE — the gym env imports these):
    World, ControlInput, sim_step, initial_world
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace

import numpy as np

from . import consts as C
from .mathx import (
    clamp,
    cross,
    mat3_inverse,
    mat3_mul_vec,
    quat_conjugate,
    quat_from_axis_angle_batch,
    quat_multiply,
    quat_multiply_batch,
    quat_normalize,
    quat_rotate,
    quat_rotate_batch,
    vlen,
)

_X = np.array([1.0, 0.0, 0.0])
_Z = np.array([0.0, 0.0, 1.0])
_ZERO3 = np.zeros(3)


# --- atmosphere (atmosphere.ts) --------------------------------------------


def density_at(alt: float) -> float:
    if alt < 0:
        return C.RHO0
    return C.RHO0 * math.exp(-alt / C.H_RHO)


def pressure_ratio(alt: float) -> float:
    if alt < 0:
        return 1.0
    return math.exp(-alt / C.H_P)


def temperature_at(alt: float) -> float:
    h = max(0.0, alt)
    layer = C.ISA_LAYERS[0]
    for cand in C.ISA_LAYERS:
        if cand[0] > h:
            break
        layer = cand
    base, t0, lapse = layer
    return t0 + lapse * (h - base)


def speed_of_sound_at(alt: float) -> float:
    return math.sqrt(C.GAMMA_AIR * C.R_AIR * temperature_at(alt))


def mach_number(speed: float, alt: float) -> float:
    return speed / speed_of_sound_at(alt)


# --- drag (drag.ts) --------------------------------------------------------


def _smoothstep(t: float) -> float:
    return t * t * (3.0 - 2.0 * t)


def cd_at(mach: float, cd_subsonic: float) -> float:
    m = max(0.0, mach)
    table = C.CD_MACH_TABLE
    last = table[-1]
    if m >= last[0]:
        return cd_subsonic * last[1]
    lo = table[0]
    hi = table[1]
    for i in range(1, len(table)):
        hi = table[i]
        if hi[0] > m:
            break
        lo = hi
    if hi[0] == lo[0]:
        return cd_subsonic * lo[1]
    t = _smoothstep((m - lo[0]) / (hi[0] - lo[0]))
    return cd_subsonic * (lo[1] + (hi[1] - lo[1]) * t)


def body_drag_force(vel_world, alt, ref_area, cd_subsonic):
    speed = vlen(vel_world)
    if speed == 0.0:
        return _ZERO3.copy()
    rho = density_at(alt)
    cd = cd_at(mach_number(speed, alt), cd_subsonic)
    coeff = -0.5 * rho * speed * cd * ref_area
    return vel_world * coeff


# --- mass model (mass.ts) --------------------------------------------------


def _propellant_height(mp: C.MassProps, prop: float) -> float:
    if prop <= 0:
        return 0.0
    return prop / (math.pi * mp.tank_radius * mp.tank_radius * mp.propellant_density)


def _propellant_com(mp: C.MassProps, prop: float) -> np.ndarray:
    h = _propellant_height(mp, prop)
    return np.array([0.0, mp.tank_bottom + h * 0.5, 0.0])


def current_mass(mp: C.MassProps, prop: float) -> float:
    return mp.dry_mass + prop


def current_com(mp: C.MassProps, prop: float) -> np.ndarray:
    if prop <= 0:
        return mp.dry_com.copy()
    prop_com = _propellant_com(mp, prop)
    total = current_mass(mp, prop)
    w_dry = mp.dry_mass / total
    w_prop = prop / total
    return mp.dry_com * w_dry + prop_com * w_prop


def _parallel_axis(mass: float, d: np.ndarray) -> np.ndarray:
    d2 = float(d @ d)
    dx, dy, dz = d
    return np.array(
        [
            mass * (d2 - dx * dx),
            -mass * dx * dy,
            -mass * dx * dz,
            -mass * dy * dx,
            mass * (d2 - dy * dy),
            -mass * dy * dz,
            -mass * dz * dx,
            -mass * dz * dy,
            mass * (d2 - dz * dz),
        ]
    )


def _cylinder_inertia(mass: float, r: float, h: float) -> np.ndarray:
    iy = 0.5 * mass * r * r
    ix = (1.0 / 12.0) * mass * (3.0 * r * r + h * h)
    return np.array([ix, 0, 0, 0, iy, 0, 0, 0, ix])


def current_inertia(mp: C.MassProps, prop: float) -> np.ndarray:
    combined = current_com(mp, prop)
    dry_disp = combined - mp.dry_com
    dry_shifted = mp.dry_inertia + _parallel_axis(mp.dry_mass, dry_disp)
    if prop <= 0:
        return dry_shifted
    h = _propellant_height(mp, prop)
    prop_com = _propellant_com(mp, prop)
    prop_own = _cylinder_inertia(prop, mp.tank_radius, h)
    prop_disp = combined - prop_com
    prop_shifted = prop_own + _parallel_axis(prop, prop_disp)
    return dry_shifted + prop_shifted


# --- thrust plant (thrust.ts) ----------------------------------------------


def _lag(current: float, target: float, tau: float, dt: float) -> float:
    if tau <= 0:
        return target
    alpha = 1.0 - math.exp(-dt / tau)
    return current + (target - current) * alpha


# The engine + surface plants are evaluated BATCHED over the engine/surface
# axis (SLS-29): profiling showed the per-engine Python loop was ~85 % of
# sim_step wall time (33 engines × quaternion ops in scalar numpy). The math
# is identical to thrust.ts/aero.ts; only reduction order of float sums
# differs (~1e-16 rel — far inside the SLS-28 parity gate, re-verified by
# tests/test_equivalence.py).


class _PackedVehicle:
    """Static per-vehicle arrays for the batched plant. Built once per Vehicle
    instance and cached on it (frozen dataclass — attach via object.__setattr__).
    """

    __slots__ = (
        "mounts",
        "directions",
        "thrust_vac",
        "thrust_sea",
        "isp_vac",
        "isp_sea",
        "max_gimbal",
        "max_gimbal_rate",
        "min_throttle",
        "tau_throttle",
        "tau_gimbal",
        "can_gimbal",
        "group_idx",
        "s_mounts",
        "s_hinges",
        "s_normals",
        "s_area",
        "s_cl_alpha",
        "s_cd0",
        "s_max_defl",
        "s_max_defl_rate",
        "s_alpha_stall",
        "s_tau",
        "s_is_fin",
        "s_ctl_idx",
    )


_GROUP_ORDER = ("centre", "inner", "outer", "ship")


def _pack_vehicle(veh: C.Vehicle) -> _PackedVehicle:
    p = _PackedVehicle()
    e = veh.engines
    p.mounts = np.array([x.mount for x in e])
    p.directions = np.array([x.direction for x in e])
    p.thrust_vac = np.array([x.thrust_vac for x in e])
    p.thrust_sea = np.array([x.thrust_sea for x in e])
    p.isp_vac = np.array([x.isp_vac for x in e])
    p.isp_sea = np.array([x.isp_sea for x in e])
    p.max_gimbal = np.array([x.max_gimbal for x in e])
    p.max_gimbal_rate = np.array([x.max_gimbal_rate for x in e])
    p.min_throttle = np.array([x.min_throttle for x in e])
    p.tau_throttle = np.array([x.tau_throttle for x in e])
    p.tau_gimbal = np.array([x.tau_gimbal for x in e])
    p.can_gimbal = np.array([x.can_gimbal for x in e])
    p.group_idx = np.array([_GROUP_ORDER.index(g) for g in veh.engine_group_of])
    s = veh.surfaces
    p.s_mounts = np.array([x.mount for x in s])
    p.s_hinges = np.array([x.hinge_axis for x in s])
    p.s_normals = np.array([x.zero_defl_normal for x in s])
    p.s_area = np.array([x.area for x in s])
    p.s_cl_alpha = np.array([x.cl_alpha for x in s])
    p.s_cd0 = np.array([x.cd0 for x in s])
    p.s_max_defl = np.array([x.max_deflection for x in s])
    p.s_max_defl_rate = np.array([x.max_deflection_rate for x in s])
    p.s_alpha_stall = np.array([x.alpha_stall for x in s])
    p.s_tau = np.array([x.tau for x in s])
    p.s_is_fin = np.array([x.kind == "grid_fin" for x in s])
    p.s_ctl_idx = np.array(veh.surface_ctl_index_of, dtype=np.int64)
    return p


def _packed(veh: C.Vehicle) -> _PackedVehicle:
    p = getattr(veh, "_packed_cache", None)
    if p is None:
        p = _pack_vehicle(veh)
        object.__setattr__(veh, "_packed_cache", p)
    return p


def _lag_arr(current: np.ndarray, target: np.ndarray, tau: np.ndarray, dt: float):
    """First-order lag, elementwise; tau<=0 snaps to target (mirrors _lag)."""
    alpha = np.where(tau > 0, 1.0 - np.exp(-dt / np.where(tau > 0, tau, 1.0)), 1.0)
    return current + (target - current) * alpha


def _engines_step(p: _PackedVehicle, states: np.ndarray, control, com_body, pr, dt):
    """Advance all engine actuator states and aggregate force/torque/mdot.
    states: (N,4) [gimbalPitch, gimbalYaw, throttle, on]."""
    groups_thr = np.array([control.engine_groups[g] for g in _GROUP_ORDER])
    groups_on = np.array([bool(control.engines_on[g]) for g in _GROUP_ORDER])
    cmd_thr = groups_thr[p.group_idx]
    cmd_on = groups_on[p.group_idx]

    thr_target = np.where(cmd_on, np.clip(cmd_thr, p.min_throttle, 1.0), 0.0)
    new_thr = _lag_arr(states[:, 2], thr_target, p.tau_throttle, dt)

    pitch_target = np.where(
        p.can_gimbal, np.clip(control.gimbal_pitch, -p.max_gimbal, p.max_gimbal), 0.0
    )
    yaw_target = np.where(
        p.can_gimbal, np.clip(control.gimbal_yaw, -p.max_gimbal, p.max_gimbal), 0.0
    )
    max_step = p.max_gimbal_rate * dt
    pitch_delta = np.clip(
        _lag_arr(states[:, 0], pitch_target, p.tau_gimbal, dt) - states[:, 0],
        -max_step,
        max_step,
    )
    yaw_delta = np.clip(
        _lag_arr(states[:, 1], yaw_target, p.tau_gimbal, dt) - states[:, 1],
        -max_step,
        max_step,
    )
    new_pitch = states[:, 0] + pitch_delta
    new_yaw = states[:, 1] + yaw_delta
    new_states = np.stack(
        [new_pitch, new_yaw, new_thr, cmd_on.astype(np.float64)], axis=1
    )

    prc = clamp(pr, 0.0, 1.0)
    thrust_mag = new_thr * (p.thrust_vac - (p.thrust_vac - p.thrust_sea) * prc)
    isp = p.isp_vac - (p.isp_vac - p.isp_sea) * prc

    # Gimballed thrust direction: rotate by qYaw(z) ⊗ qPitch(x) (thrust.ts).
    q_pitch = quat_from_axis_angle_batch(
        np.broadcast_to(_X, (len(new_pitch), 3)), new_pitch
    )
    q_yaw = quat_from_axis_angle_batch(
        np.broadcast_to(_Z, (len(new_yaw), 3)), new_yaw
    )
    q = quat_multiply_batch(q_yaw, q_pitch)
    dirs = quat_rotate_batch(q, p.directions)

    forces = dirs * thrust_mag[:, None]
    arms = p.mounts - com_body
    torques = np.cross(arms, forces)
    mdots = np.where(isp > 0, thrust_mag / (isp * C.G0), 0.0)

    return new_states, forces.sum(axis=0), torques.sum(axis=0), float(mdots.sum())


def _surfaces_step(
    p: _PackedVehicle, defl, control, rel_vel, omega_body, attitude, com_body, density, dt
):
    """Advance all surface deflections and aggregate aero force/torque.
    defl: (M,) realised deflections."""
    m = len(defl)
    if m == 0:
        return defl, _ZERO3.copy(), _ZERO3.copy()
    fins = np.asarray(control.fins, dtype=np.float64)
    flaps = np.asarray(control.flaps, dtype=np.float64)
    targets = np.where(
        p.s_is_fin,
        fins[np.minimum(p.s_ctl_idx, max(len(fins) - 1, 0))] if len(fins) else 0.0,
        flaps[np.minimum(p.s_ctl_idx, max(len(flaps) - 1, 0))] if len(flaps) else 0.0,
    )
    clamped = np.clip(targets, -p.s_max_defl, p.s_max_defl)
    desired = _lag_arr(defl, clamped, p.s_tau, dt)
    delta = np.clip(desired - defl, -p.s_max_defl_rate * dt, p.s_max_defl_rate * dt)
    new_defl = defl + delta

    if density < 1e-12:
        return new_defl, _ZERO3.copy(), _ZERO3.copy()

    arms = p.s_mounts - com_body
    rot_contrib = np.cross(np.broadcast_to(omega_body, (m, 3)), arms)
    v_world_in_body = quat_rotate(quat_conjugate(attitude), rel_vel)
    v_mount = v_world_in_body + rot_contrib
    speed = np.sqrt((v_mount * v_mount).sum(axis=1))
    live = speed >= 1e-9
    safe_speed = np.where(live, speed, 1.0)
    wind_dir = v_mount * (-1.0 / safe_speed)[:, None]

    q_defl = quat_from_axis_angle_batch(p.s_hinges, new_defl)
    n = quat_rotate_batch(q_defl, p.s_normals)
    sin_alpha = np.clip((n * wind_dir).sum(axis=1), -1.0, 1.0)
    alpha = np.arcsin(sin_alpha)
    cl = p.s_cl_alpha * np.clip(alpha, -p.s_alpha_stall, p.s_alpha_stall)
    cd = p.s_cd0 + alpha * alpha
    qdyn = 0.5 * density * speed * speed
    lift_mag = qdyn * p.s_area * cl
    drag_mag = qdyn * p.s_area * cd

    ndw = (n * wind_dir).sum(axis=1)
    n_perp = n - wind_dir * ndw[:, None]
    n_perp_len = np.sqrt((n_perp * n_perp).sum(axis=1))
    lift_ok = n_perp_len > 1e-9
    safe_len = np.where(lift_ok, n_perp_len, 1.0)
    lift = n_perp * np.where(lift_ok, lift_mag / safe_len, 0.0)[:, None]
    drag = wind_dir * drag_mag[:, None]
    forces = np.where(live[:, None], lift + drag, 0.0)
    torques = np.cross(arms, forces)

    return new_defl, forces.sum(axis=0), torques.sum(axis=0)


# --- integrator (integrator.ts) --------------------------------------------


def _derivative(vel, att, omega, force_world, torque_body, mass, inertia, inertia_inv):
    d_vel = force_world / mass
    omega_pure = np.array([omega[0], omega[1], omega[2], 0.0])
    q_omega = quat_multiply(att, omega_pure)
    d_att = q_omega * 0.5
    i_omega = mat3_mul_vec(inertia, omega)
    gyro = cross(omega, i_omega)
    d_omega = mat3_mul_vec(inertia_inv, torque_body - gyro)
    return vel.copy(), d_vel, d_att, d_omega


def _rk4_step(pos, vel, att, omega, force_world, torque_body, mass, inertia, dt):
    inertia_inv = mat3_inverse(inertia)

    def ev(p, v, a, w):
        return _derivative(v, a, w, force_world, torque_body, mass, inertia, inertia_inv)

    k1 = ev(pos, vel, att, omega)
    half = dt * 0.5
    k2 = ev(
        pos + k1[0] * half,
        vel + k1[1] * half,
        att + k1[2] * half,
        omega + k1[3] * half,
    )
    k3 = ev(
        pos + k2[0] * half,
        vel + k2[1] * half,
        att + k2[2] * half,
        omega + k2[3] * half,
    )
    k4 = ev(
        pos + k3[0] * dt,
        vel + k3[1] * dt,
        att + k3[2] * dt,
        omega + k3[3] * dt,
    )
    sixth = dt / 6.0

    def wsum(i):
        return (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]) * sixth

    new_pos = pos + wsum(0)
    new_vel = vel + wsum(1)
    d_att = wsum(2)
    new_att = quat_normalize(att + d_att)
    new_omega = omega + wsum(3)
    return new_pos, new_vel, new_att, new_omega


# --- world / simStep (world.ts) --------------------------------------------


@dataclass
class World:
    position: np.ndarray
    velocity: np.ndarray
    attitude: np.ndarray
    angular_velocity: np.ndarray
    mass: float
    inertia: np.ndarray
    engine_states: np.ndarray  # (N, 4)
    surface_states: np.ndarray  # (M,)
    propellant_mass: float
    t: float = 0.0


@dataclass
class ControlInput:
    engine_groups: dict
    engines_on: dict
    gimbal_pitch: float = 0.0
    gimbal_yaw: float = 0.0
    fins: np.ndarray = field(default_factory=lambda: np.zeros(0))
    flaps: np.ndarray = field(default_factory=lambda: np.zeros(0))


def initial_world(scenario_id: str) -> World:
    s = C.SCENARIOS[scenario_id]
    veh = C.VEHICLES[s.vehicle]
    n = len(veh.engines)
    m = len(veh.surfaces)
    return World(
        position=s.position.copy(),
        velocity=s.velocity.copy(),
        attitude=s.attitude.copy(),
        angular_velocity=s.angular_velocity.copy(),
        mass=s.mass,
        inertia=s.inertia.copy(),
        engine_states=np.zeros((n, 4)),
        surface_states=np.zeros(m),
        propellant_mass=s.propellant_mass,
        t=0.0,
    )


def sim_step(
    world: World,
    vehicle: C.Vehicle,
    control: ControlInput,
    dt: float,
    gravity: float,
    wind: np.ndarray = _ZERO3,
) -> World:
    mp = vehicle.mass_props
    p = _packed(vehicle)

    # 1+2. per-engine commands from grouped control; batched plant aggregation.
    alt = float(world.position[1])
    pr = pressure_ratio(alt)
    density = density_at(alt)
    com_body = current_com(mp, world.propellant_mass)

    new_engine_states, force_body, torque_body, mdot_total = _engines_step(
        p, world.engine_states, control, com_body, pr, dt
    )

    # wind-relative velocity for aero + drag.
    rel_vel = world.velocity - wind

    # 3. aero surfaces (batched).
    new_surface_states, aero_force, aero_torque = _surfaces_step(
        p,
        world.surface_states,
        control,
        rel_vel,
        world.angular_velocity,
        world.attitude,
        com_body,
        density,
        dt,
    )

    # 4. body -> world for thrust + aero.
    thrust_world = quat_rotate(world.attitude, force_body)
    aero_world = quat_rotate(world.attitude, aero_force)

    # 5. gravity + body drag (world).
    m = world.mass
    gravity_world = np.array([0.0, -m * gravity, 0.0])
    drag_world = body_drag_force(rel_vel, alt, vehicle.body_ref_area, vehicle.body_cd)

    # Match world.ts association EXACTLY: (thrust+aero) + (gravity+drag).
    # Float addition is non-associative; a different grouping shifts the last
    # bits and, through near-cancelling symmetric aero forces, the parity diff.
    force_world = (thrust_world + aero_world) + (gravity_world + drag_world)
    total_torque_body = torque_body + aero_torque

    # 6. integrate.
    new_pos, new_vel, new_att, new_omega = _rk4_step(
        world.position,
        world.velocity,
        world.attitude,
        world.angular_velocity,
        force_world,
        total_torque_body,
        world.mass,
        world.inertia,
        dt,
    )

    # 7. burn fuel; refresh mass + inertia on the new rigid body.
    new_prop = max(0.0, world.propellant_mass - mdot_total * dt)
    new_mass = current_mass(mp, new_prop)
    new_inertia = current_inertia(mp, new_prop)

    return World(
        position=new_pos,
        velocity=new_vel,
        attitude=new_att,
        angular_velocity=new_omega,
        mass=new_mass,
        inertia=new_inertia,
        engine_states=new_engine_states,
        surface_states=new_surface_states,
        propellant_mass=new_prop,
        t=world.t + dt,
    )


# `replace` re-exported for callers that want to tweak a World immutably.
__all__ = ["World", "ControlInput", "sim_step", "initial_world", "replace"]
