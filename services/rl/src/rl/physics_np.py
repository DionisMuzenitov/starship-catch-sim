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
    quat_from_axis_angle,
    quat_multiply,
    quat_normalize,
    quat_rotate,
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


def _update_engine(eng: C.Engine, state: np.ndarray, cmd: dict, dt: float) -> np.ndarray:
    # state = [gimbalPitch, gimbalYaw, throttle, on]
    gp, gy, thr, _on = state
    throttle_target = clamp(cmd["throttle"], eng.min_throttle, 1.0) if cmd["on"] else 0.0
    next_thr = _lag(thr, throttle_target, eng.tau_throttle, dt)

    pitch_target = clamp(cmd["pitch"], -eng.max_gimbal, eng.max_gimbal) if eng.can_gimbal else 0.0
    yaw_target = clamp(cmd["yaw"], -eng.max_gimbal, eng.max_gimbal) if eng.can_gimbal else 0.0

    max_step = eng.max_gimbal_rate * dt
    pitch_lagged = _lag(gp, pitch_target, eng.tau_gimbal, dt)
    pitch_delta = clamp(pitch_lagged - gp, -max_step, max_step)
    yaw_lagged = _lag(gy, yaw_target, eng.tau_gimbal, dt)
    yaw_delta = clamp(yaw_lagged - gy, -max_step, max_step)

    return np.array([gp + pitch_delta, gy + yaw_delta, next_thr, 1.0 if cmd["on"] else 0.0])


def _thrust_at_pressure(eng: C.Engine, pr: float) -> float:
    p = clamp(pr, 0.0, 1.0)
    return eng.thrust_vac - (eng.thrust_vac - eng.thrust_sea) * p


def _isp_at_pressure(eng: C.Engine, pr: float) -> float:
    p = clamp(pr, 0.0, 1.0)
    return eng.isp_vac - (eng.isp_vac - eng.isp_sea) * p


def _gimbal_direction(eng: C.Engine, state: np.ndarray) -> np.ndarray:
    q_pitch = quat_from_axis_angle(_X, state[0])
    q_yaw = quat_from_axis_angle(_Z, state[1])
    q = quat_multiply(q_yaw, q_pitch)
    return quat_rotate(q, eng.direction)


def _engine_force_torque(eng: C.Engine, state: np.ndarray, com_body, pr):
    thrust_mag = state[2] * _thrust_at_pressure(eng, pr)
    if thrust_mag <= 0:
        return _ZERO3.copy(), _ZERO3.copy(), 0.0
    direction = _gimbal_direction(eng, state)
    force = direction * thrust_mag
    arm = eng.mount - com_body
    torque = cross(arm, force)
    isp = _isp_at_pressure(eng, pr)
    mdot = thrust_mag / (isp * C.G0) if isp > 0 else 0.0
    return force, torque, mdot


# --- aero surfaces (aero.ts) -----------------------------------------------


def _update_surface(s: C.Surface, defl: float, target: float, dt: float) -> float:
    clamped = clamp(target, -s.max_deflection, s.max_deflection)
    desired = _lag(defl, clamped, s.tau, dt)
    max_step = s.max_deflection_rate * dt
    delta = clamp(desired - defl, -max_step, max_step)
    return defl + delta


def _surface_force_torque(s, defl, v_world, omega_body, attitude, com_body, density):
    if density < 1e-12:
        return _ZERO3.copy(), _ZERO3.copy()
    arm = s.mount - com_body
    rot_contrib = cross(omega_body, arm)
    v_world_in_body = quat_rotate(quat_conjugate(attitude), v_world)
    v_mount = v_world_in_body + rot_contrib
    speed = vlen(v_mount)
    if speed < 1e-9:
        return _ZERO3.copy(), _ZERO3.copy()
    wind_dir = v_mount * (-1.0 / speed)
    q_defl = quat_from_axis_angle(s.hinge_axis, defl)
    n = quat_rotate(q_defl, s.zero_defl_normal)
    sin_alpha = clamp(float(n @ wind_dir), -1.0, 1.0)
    alpha = math.asin(sin_alpha)
    alpha_for_cl = clamp(alpha, -s.alpha_stall, s.alpha_stall)
    cl = s.cl_alpha * alpha_for_cl
    cd = s.cd0 + alpha * alpha
    q = 0.5 * density * speed * speed
    lift_mag = q * s.area * cl
    drag_mag = q * s.area * cd
    n_perp = n - wind_dir * float(n @ wind_dir)
    n_perp_len = vlen(n_perp)
    lift = n_perp * (lift_mag / n_perp_len) if n_perp_len > 1e-9 else _ZERO3.copy()
    drag = wind_dir * drag_mag
    force = lift + drag
    torque = cross(arm, force)
    return force, torque


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

    # 1. per-engine commands from grouped control.
    # 2. plant aggregation in body frame.
    alt = float(world.position[1])
    pr = pressure_ratio(alt)
    density = density_at(alt)
    com_body = current_com(mp, world.propellant_mass)

    force_body = _ZERO3.copy()
    torque_body = _ZERO3.copy()
    mdot_total = 0.0
    new_engine_states = np.empty_like(world.engine_states)
    for i, eng in enumerate(vehicle.engines):
        group = vehicle.engine_group_of[i]
        cmd = {
            "pitch": control.gimbal_pitch if eng.can_gimbal else 0.0,
            "yaw": control.gimbal_yaw if eng.can_gimbal else 0.0,
            "throttle": control.engine_groups[group],
            "on": control.engines_on[group],
        }
        st = _update_engine(eng, world.engine_states[i], cmd, dt)
        new_engine_states[i] = st
        f, tq, md = _engine_force_torque(eng, st, com_body, pr)
        force_body = force_body + f
        torque_body = torque_body + tq
        mdot_total += md

    # wind-relative velocity for aero + drag.
    rel_vel = world.velocity - wind

    # 3. aero surfaces.
    new_surface_states = np.empty_like(world.surface_states)
    aero_force = _ZERO3.copy()
    aero_torque = _ZERO3.copy()
    for i, s in enumerate(vehicle.surfaces):
        idx = vehicle.surface_ctl_index_of[i]
        if s.kind == "grid_fin":
            target = control.fins[idx] if idx < len(control.fins) else 0.0
        else:
            target = control.flaps[idx] if idx < len(control.flaps) else 0.0
        next_defl = _update_surface(s, float(world.surface_states[i]), float(target), dt)
        new_surface_states[i] = next_defl
        f, tq = _surface_force_torque(
            s, next_defl, rel_vel, world.angular_velocity, world.attitude, com_body, density
        )
        aero_force = aero_force + f
        aero_torque = aero_torque + tq

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
