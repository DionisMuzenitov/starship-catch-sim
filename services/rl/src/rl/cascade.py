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

from .physics_np import pressure_ratio as C_pressure_ratio


class CascadeParams:
    def __init__(
        self,
        brake_kappa: float = 0.85,  # ignite when required decel >= kappa*available
        brake_reserve_m: float = 150.0,  # finish the brake this high above the catch
        coast_throttle: float = 0.45,  # centre-ring attitude-authority burn
        vy_k: float = 0.10,  # descent-profile slope (1/s)
        vy_min: float = 0.8,  # gentlest commanded descent (m/s)
        vy_max: float = 35.0,  # steepest profile descent (m/s)
        thr_hover: float = 0.84,  # centre throttle for TWR ≈ 1 at 10 % fuel
        thr_kp: float = 0.12,  # centre-throttle gain on vy error
        pos_kp: float = 0.06,  # lateral position gain (m/s² per m)
        vel_kd: float = 0.40,  # lateral velocity gain (m/s² per m/s)
        acc_max: float = 4.0,  # lateral accel bound (m/s²)
        a_thrust: float = 12.0,  # assumed thrust accel for lean scaling (m/s²)
        lean_cmd_max: float = 1.0,  # fraction of env LEAN_MAX to command
        aim_x_offset: float = 3.0,  # aim this far +x of the catch point: the
        # truss face is only 2.5 m from it in -x; aiming at x≈10.5 keeps the
        # PD's overshoot away from steel while staying inside both the
        # capture box (x∈[5,12]) and the 10 m distance tolerance.
        hold_radius: float = 60.0,  # hold altitude until this close overhead
        hold_alt: float = 120.0,  # holding altitude above the catch point (m)
        v_lat_max: float = 12.0,  # near-field transit equilibrium speed (m/s)
        v_transit_max: float = 220.0,  # hard cap on far-field transit speed
        vel_kd_v2: float = 0.8,  # gain onto the braking-envelope velocity target
        wall_x: float = 7.0,  # virtual wall: push +x when closer than this
        # (must stay OUTSIDE the capture box — its centre is x = 8.5; a wall at
        # 9.0 shoved the vehicle during final entry and caused near-misses)
        wall_k: float = 2.5,  # wall stiffness (m/s² per m of intrusion)
    ):
        self.brake_kappa = brake_kappa
        self.brake_reserve_m = brake_reserve_m
        self.coast_throttle = coast_throttle
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
        self.hold_radius = hold_radius
        self.hold_alt = hold_alt
        self.v_lat_max = v_lat_max
        self.v_transit_max = v_transit_max
        self.vel_kd_v2 = vel_kd_v2
        self.wall_x = wall_x
        self.wall_k = wall_k


def cascade_action(env, params: CascadeParams | None = None) -> np.ndarray:
    """One 4-dim inner-loop action from the current env state. Reads the
    TRUE world (teacher has clean state; the student only sees obs).

    v2 (SLS-51 imitation-first): braking-envelope lateral speed cap (v1's
    raw PD built 17 m/s of closing speed it could not brake — flew THROUGH
    the tower), altitude hold until roughly overhead (v1 descended to truss
    height 400 m out), and coast attitude authority (ballistic starts
    tumbled with engines off, then fired the landing burn sideways)."""
    p = params or CascadeParams()
    w = env.unwrapped.world
    tgt = env.unwrapped.scenario.target_position

    from .env import LEAN_MAX

    vy = float(w.velocity[1])
    alt = float(w.position[1]) - float(tgt[1])  # height above catch point
    dx = float(w.position[0] - (tgt[0] + p.aim_x_offset))
    dz = float(w.position[2] - tgt[2])
    vx = float(w.velocity[0])
    vz = float(w.velocity[2])
    h_dist = float(np.hypot(dx, dz))

    # --- vertical ------------------------------------------------------------
    # v3 (full descent): energy-based suicide-burn ignition. Ignite the
    # 13-engine brake when the decel required to null vy above the catch
    # point reaches kappa x the decel actually available (thrust at this
    # altitude's back-pressure, current mass). Before that: COAST — a fixed
    # attitude-authority burn only (v2's profile tracking would command full
    # throttle for the entire 65 km fall and exhaust the tank).
    veh = env.unwrapped.vehicle

    pr = C_pressure_ratio(float(w.position[1]))
    f13 = 0.0
    n_centre = 0
    f_centre_sea = 0.0
    for i, e in enumerate(veh.engines):
        g = veh.engine_group_of[i]
        if g in ("centre", "inner"):
            f13 += e.thrust_vac - (e.thrust_vac - e.thrust_sea) * pr
        if g == "centre":
            n_centre += 1
            f_centre_sea = e.thrust_sea
    m = float(w.mass)
    a_avail = max(f13 / m - 9.80665, 1.0)
    a_centre = max(n_centre * f_centre_sea / m - 9.80665, 0.5)
    required = (vy * vy) / (2.0 * max(alt - p.brake_reserve_m, 1.0))
    # Two-tier brake: the energy-optimal 13-engine ignition high up, AND a
    # terminal-zone assist when the centre-only ring physically cannot track
    # the descent profile (v3's late ignition alone regressed dock — the
    # profile PD saturated at centre thrust and arrived hot).
    need_brake = vy < -3.0 and (
        required >= p.brake_kappa * a_avail
        or (alt < 1_500.0 and vy < -15.0 and required >= 0.85 * a_centre)
    )

    thr_ff = m * 9.80665 / (n_centre * f_centre_sea)
    if need_brake:
        thr_c, thr_i = 1.0, 1.0
    elif vy < -80.0 and alt > 1_500.0:
        # coast: fall ballistically with just enough thrust for gimbal
        # authority (engines-off coast tumbles; a tumbled landing burn
        # fires sideways — v1 crashed at 300 m/s).
        thr_c, thr_i = p.coast_throttle, 0.0
    else:
        if h_dist > p.hold_radius:
            # Not overhead yet: hold a safe altitude above the tower while
            # translating (v1 sank to truss height 400 m out and collided).
            vy_tgt = float(np.clip(0.15 * (p.hold_alt - alt), -p.vy_max, 8.0))
        else:
            vy_tgt = -min(max(p.vy_k * alt, p.vy_min), p.vy_max)
        thr_c = float(np.clip(thr_ff + p.thr_kp * (vy_tgt - vy), 0.0, 1.0))
        thr_i = 0.0
        if alt > 600.0 and vy < -40.0:
            thr_c = max(thr_c, p.coast_throttle)

    # --- lateral: saturated-proportional PD with envelope-scaled transit ------
    # One continuous law. Clamping the P-term's effective distance bounds the
    # transit speed at v_eq = kp*d_eff_max/kd and braking begins naturally
    # inside the clamp — no mode switch, no sign discontinuity (both of which
    # limit-cycled against the attitude lag). v3: the clamp GROWS with
    # distance under a braking envelope, or a 65 km entry's natural ~100 m/s
    # downrange drift gets braked to corridor speed and the vehicle hovers
    # 8 km from the tower until the tank runs dry (full-descent trace).
    a_lat = p.a_thrust * LEAN_MAX * p.lean_cmd_max
    v_allow = min(
        p.v_transit_max,
        max(p.v_lat_max, float(np.sqrt(2.0 * a_lat * 0.4 * h_dist))),
    )
    d_sat = p.vel_kd * v_allow / p.pos_kp
    dxe = float(np.clip(dx, -d_sat, d_sat))
    dze = float(np.clip(dz, -d_sat, d_sat))
    ax = -(p.pos_kp * dxe + p.vel_kd * vx)
    az = -(p.pos_kp * dze + p.vel_kd * vz)
    # predictive anti-truss wall (face at x=6). Active through the whole
    # descent band INCLUDING above the roof (y=146): descents from the hold
    # altitude drifted across x<6 while y>170 and settled onto the tower
    # roof (v3 dock trace: collisions at exactly y=146.0).
    if float(w.position[1]) < 220.0:
        x_pred = float(w.position[0]) + 1.0 * vx
        ax += p.wall_k * max(0.0, p.wall_x - min(float(w.position[0]), x_pred))
        # Directional envelope TOWARD the wall: never close on the truss
        # faster than the lean authority can stop (envelope transit speeds
        # of 25-50 m/s blew through the static wall — v3 approach trace).
        x_gap = max(float(w.position[0]) - p.wall_x, 0.0)
        vx_cap = float(np.sqrt(2.0 * a_lat * 0.5 * x_gap))
        if vx < -vx_cap:
            ax += 1.5 * (-vx_cap - vx)
    ax = float(np.clip(ax, -p.acc_max, p.acc_max))
    az = float(np.clip(az, -p.acc_max, p.acc_max))

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
