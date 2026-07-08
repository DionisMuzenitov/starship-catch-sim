"""Scripted cascade controller — the BC teacher + scripted baseline (SLS-51).

Flies `StarshipCatchEnv(attitude_inner_loop=True)` (4-dim action:
[thr_centre, thr_inner, lean_x, lean_z]); the env's embedded PD does the
gimbal work, so this outer loop only decides vertical throttle strategy and
where to lean.

Vertical: two-phase — kinetic-energy check triggers a centre+inner hard
brake, otherwise centre-only PD around a descent profile (centre-only max
TWR ≈ 1.19, both-groups min TWR ≈ 2.1 — the plant demands bang-bang
staging, like the real landing burn: 13 engines then 3).

Horizontal: position+velocity PD → desired lateral acceleration → lean
target (thrust tilts with the body; lean ≈ a_des / a_thrust).

This controller does NOT need to be perfect: as the BC teacher it only has
to put demonstrations in the right basin (descend, approach, arrive slow and
upright); PPO refines from there. Measured quality (6 seeds/stage, calm):
hover 6/6 caught, dock 4/6, approach 1/6 — `bc_pretrain.py` prints the
outcome histogram of every demo batch it collects.
"""

from __future__ import annotations

import numpy as np


class CascadeParams:
    def __init__(
        self,
        brake_margin: float = 1.2,  # trigger brake when v²/2h exceeds this (m/s²)
        vy_k: float = 0.10,  # descent-profile slope (1/s)
        vy_min: float = 0.8,  # gentlest commanded descent (m/s)
        vy_max: float = 20.0,  # steepest profile descent (m/s)
        thr_hover: float = 0.84,  # centre throttle for TWR ≈ 1 at 10 % fuel
        thr_kp: float = 0.12,  # centre-throttle gain on vy error
        pos_kp: float = 0.04,  # lateral position gain (m/s² per m)
        vel_kd: float = 0.30,  # lateral velocity gain (m/s² per m/s)
        acc_max: float = 2.0,  # lateral accel bound (m/s²)
        a_thrust: float = 12.0,  # assumed thrust accel for lean scaling (m/s²)
        lean_cmd_max: float = 0.8,  # fraction of env LEAN_MAX to command
        aim_x_offset: float = 2.0,  # aim this far +x of the catch point: the
        # truss face is only 2.5 m from it in -x; aiming at x≈10.5 keeps the
        # PD's overshoot away from steel while staying inside both the
        # capture box (x∈[5,12]) and the 10 m distance tolerance.
        wall_x: float = 7.0,  # virtual wall: push +x when closer than this
        # (must stay OUTSIDE the capture box — its centre is x = 8.5; a wall at
        # 9.0 shoved the vehicle during final entry and caused near-misses)
        wall_k: float = 2.5,  # wall stiffness (m/s² per m of intrusion)
    ):
        self.brake_margin = brake_margin
        self.vy_k = vy_k
        self.vy_min = vy_min
        self.vy_max = vy_max
        self.thr_hover = thr_hover
        self.thr_kp = thr_kp
        self.pos_kp = pos_kp
        self.vel_kd = vel_kd
        self.acc_max = acc_max
        self.a_thrust = a_thrust
        self.lean_cmd_max = lean_cmd_max
        self.aim_x_offset = aim_x_offset
        self.wall_x = wall_x
        self.wall_k = wall_k


def cascade_action(env, params: CascadeParams | None = None) -> np.ndarray:
    """One 4-dim inner-loop action from the current env state. Reads the
    TRUE world (teacher has clean state; the student only sees obs)."""
    p = params or CascadeParams()
    w = env.unwrapped.world
    tgt = env.unwrapped.scenario.target_position

    vy = float(w.velocity[1])
    alt = float(w.position[1]) - float(tgt[1])  # height above catch point

    # vertical: brake if kinetic energy demands more decel than centre can give
    need_brake = vy < -3.0 and (vy * vy) / (2.0 * max(alt, 1.0)) > p.brake_margin
    if need_brake:
        thr_c, thr_i = 1.0, 1.0
    else:
        vy_tgt = -min(max(p.vy_k * alt, p.vy_min), p.vy_max)
        # Mass feed-forward: a constant hover throttle drifts as fuel burns
        # (P-only loop hovered ABOVE the box and slowly rose — SLS-51 trace).
        # The teacher may read the true mass; the exact hover throttle is
        # m·g / (n_centre · F_engine).
        veh = env.unwrapped.vehicle
        centre = [
            e for i, e in enumerate(veh.engines)
            if veh.engine_group_of[i] == "centre"
        ]
        thr_ff = float(w.mass) * 9.80665 / (len(centre) * centre[0].thrust_sea)
        thr_c = float(np.clip(thr_ff + p.thr_kp * (vy_tgt - vy), 0.0, 1.0))
        thr_i = 0.0

    # horizontal: PD position/velocity -> desired accel -> lean target
    dx = float(w.position[0] - (tgt[0] + p.aim_x_offset))
    dz = float(w.position[2] - tgt[2])
    vx = float(w.velocity[0])
    vz = float(w.velocity[2])
    ax = -(p.pos_kp * dx + p.vel_kd * vx)
    az = -(p.pos_kp * dz + p.vel_kd * vz)
    # virtual wall: never drift into the tower truss (its face is at x = 6).
    # Predictive — reacts to where momentum puts the vehicle ~1.5 s out, or
    # a fast inbound approach blows through a static wall (SLS-51: 4/6 dock
    # starts clipped the truss).
    x_pred = float(w.position[0]) + 1.0 * vx
    ax += p.wall_k * max(0.0, p.wall_x - min(float(w.position[0]), x_pred))
    ax = float(np.clip(ax, -p.acc_max, p.acc_max))
    az = float(np.clip(az, -p.acc_max, p.acc_max))
    # action fraction: the env scales the lean action by LEAN_MAX (rad of
    # body-up deflection), and achieved accel ~ a_thrust * lean_rad — so one
    # unit of action buys a_thrust * LEAN_MAX m/s^2 (~1.8), NOT a_thrust.
    from .env import LEAN_MAX

    per_unit = p.a_thrust * LEAN_MAX
    lean_x = float(np.clip(ax / per_unit, -1.0, 1.0)) * p.lean_cmd_max
    lean_z = float(np.clip(az / per_unit, -1.0, 1.0)) * p.lean_cmd_max

    return np.array([thr_c, thr_i, lean_x, lean_z])


def rollout_cascade(env, seed: int, max_steps: int = 3000,
                    params: CascadeParams | None = None):
    """Roll one episode; returns (observations, actions, outcome, ep_return).
    obs/actions are aligned: actions[i] was taken at observations[i]."""
    obs, _ = env.reset(seed=seed)
    obs_list, act_list = [], []
    total = 0.0
    info = {}
    for _ in range(max_steps):
        a = cascade_action(env, params)
        obs_list.append(np.asarray(obs, dtype=np.float64))
        act_list.append(a)
        obs, r, term, trunc, info = env.step(a)
        total += r
        if term or trunc:
            break
    return (
        np.array(obs_list),
        np.array(act_list),
        info.get("outcome", "none"),
        total,
    )
