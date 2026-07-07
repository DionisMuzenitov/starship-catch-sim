"""`StarshipCatchEnv` — a Gymnasium env over the numpy physics port (SLS-28/29).

Observation (17-dim Box): position(3), velocity(3), attitude quaternion(4),
angular velocity(3), normalised fuel(1), tower-relative position(3).
With `normalize_obs=True` each component is divided by a FIXED scale
(`OBS_SCALE`) — fixed rather than running statistics so the exact same
constants ship with the ONNX export (SLS-30).

Action (Box[-1,1]): per-group throttles (centre/inner/outer/ship), gimbal
pitch/yaw, per-surface deflections — 10-dim for the booster. With
`booster_landing_action=True` the unused outer/ship groups are masked off
(real catches burn 3 centre + 10 inner only) → 8-dim, easier exploration.

Reward: potential-based shaping (Ng, Harada & Russell 1999) + sparse
terminal bonuses + control-effort penalty — see docs/rl-reward.md. The
shaping discount `gamma` MUST match the training discount for policy
invariance to hold.

SLS-29 additions: scenario wind (layered + OU turbulence, seeded), ballistic
start-state curriculum (`start_alt_range`), vehicle override + obs noise
hooks for domain randomization, `set_stage()` for curriculum promotion.
Physics runs at PHYSICS_DT (250 Hz); each env step applies one action for
`frame_skip` substeps (25 Hz control by default).
"""

from __future__ import annotations

import math

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from . import consts as C
from .ballistic import start_from_spec
from .physics_np import ControlInput, World, initial_world, sim_step
from .wind_np import WindField, build_wind

_GROUPS = ("centre", "inner", "outer", "ship")
_Y = np.array([0.0, 1.0, 0.0])
_GRAVITY = 9.80665

# Reward weights (see docs/rl-reward.md for the rationale).
# Scaled so the telescoped shaping over an episode is O(10) — commensurate
# with (but below) the ±100 terminal. At the original 1e-3/m the shaping
# contributed ~±3 vs a −100 terminal and PPO saw a flat return (SLS-29
# smoke-run finding). Scaling Φ is safe: potential-based shaping is
# policy-invariant for ANY Φ (Ng et al. 1999).
W_POS = 5.0e-3  # per metre of distance-to-target
W_VSPEED = 2.5e-2  # per m/s of vertical speed
W_HSPEED = 2.5e-2  # per m/s of horizontal speed
W_TILT = 3.0  # per rad of tilt from upright
W_OMEGA = 3.0  # per rad/s of angular rate — the earliest anti-tumble signal
R_CATCH = 100.0
R_FAIL = 100.0
# Graded-terminal bonus: failures earn back up to R_MISS_BONUS by how close to
# catchable the terminal state was (see _miss_score / docs/rl-reward.md). Flat
# -R_FAIL gave PPO no gradient THROUGH the terminal event — the 150k-step
# smoke run sat at ep_rew ≈ -91 with zero movement (SLS-29 finding).
R_MISS_BONUS = 60.0
# e-folding of the miss score. 8 ≈ "one tolerance-normalised unit of error
# costs ~12 % of the bonus": a slow upright crash at the tower base (≈ 9 units,
# ground is ~81 m below the catch point) still earns ~-79 vs -100 ballistic —
# ~20 reward points of gradient across the approach problem.
MISS_SOFTNESS = 8.0
W_CTRL = 1.0e-3  # per unit of summed throttle (fuel-efficiency nudge)

# Attitude inner loop (SLS-51): PD gains mapping lean-target error + body
# rates -> gimbal command. Signs from the SLS-29 cascade sign search; gains
# from a step-response sweep (K_ATT=8/K_RATE=4 overshot 46 % and oscillated
# under the gimbal actuator lag; 4/8 settles on target with no overshoot).
# LEAN_MAX bounds commanded lean (horizontal components of body-up).
K_ATT = 4.0
K_RATE = 8.0
LEAN_MAX = 0.15

# Fixed observation scales (normalize_obs=True): keeps every component ~O(1).
# MUST stay in sync with the ONNX export pipeline (SLS-30).
OBS_SCALE = np.array(
    [5_000.0, 70_000.0, 15_000.0,  # position
     300.0, 300.0, 300.0,          # velocity
     1.0, 1.0, 1.0, 1.0,           # attitude quaternion
     0.5, 0.5, 0.5,                # angular velocity
     1.0,                          # fuel fraction
     5_000.0, 70_000.0, 15_000.0]  # tower-relative position
)

# Per-component observation-noise sigmas at scale 1.0 (domain randomization).
OBS_NOISE_SIGMA = np.array(
    [2.0, 2.0, 2.0,
     0.5, 0.5, 0.5,
     0.002, 0.002, 0.002, 0.002,
     0.002, 0.002, 0.002,
     0.002,
     2.0, 2.0, 2.0]
)


def _tilt_rad(attitude: np.ndarray) -> float:
    from .mathx import quat_rotate

    body_up = quat_rotate(attitude, np.array([0.0, 1.0, 0.0]))
    return math.acos(max(-1.0, min(1.0, float(body_up[1]))))


class StarshipCatchEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(
        self,
        scenario_id: str = "booster-descent-calm",
        frame_skip: int = 10,
        max_episode_steps: int = 6000,
        position_jitter_m: float = 20.0,
        velocity_jitter_frac: float = 0.05,
        velocity_jitter_mps: float = 0.0,
        gamma: float = 0.99,
        booster_landing_action: bool = False,
        attitude_inner_loop: bool = False,
        normalize_obs: bool = False,
        obs_noise_scale: float = 0.0,
        start_alt_range: tuple[float, float] | dict | None = None,
        vehicle: C.Vehicle | None = None,
        wind: WindField | None = None,
    ):
        super().__init__()
        self.frame_skip = frame_skip
        self.max_episode_steps = max_episode_steps
        self.position_jitter_m = position_jitter_m
        self.velocity_jitter_frac = velocity_jitter_frac
        self.velocity_jitter_mps = velocity_jitter_mps
        self.gamma = gamma
        self.booster_landing_action = booster_landing_action
        self.attitude_inner_loop = attitude_inner_loop
        self.normalize_obs = normalize_obs
        self.obs_noise_scale = obs_noise_scale
        self.start_alt_range = start_alt_range
        self.dt = C.PHYSICS_DT

        self._vehicle_override = vehicle
        self._wind_override = wind
        self._configure_scenario(scenario_id)

        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf, shape=(17,), dtype=np.float64
        )
        self.action_space = spaces.Box(
            low=-1.0, high=1.0, shape=(self.n_act,), dtype=np.float64
        )

        self.world: World | None = None
        self.steps = 0

    # -- configuration --------------------------------------------------------

    def _configure_scenario(self, scenario_id: str) -> None:
        self.scenario_id = scenario_id
        self.scenario = C.SCENARIOS[scenario_id]
        self.vehicle = self._vehicle_override or C.VEHICLES[self.scenario.vehicle]
        self.wind: WindField = self._wind_override or build_wind(
            self.scenario.wind_spec or {"kind": "constant", "value": [0, 0, 0]}
        )
        self._n_fins = sum(1 for s in self.vehicle.surfaces if s.kind == "grid_fin")
        self._n_flaps = sum(1 for s in self.vehicle.surfaces if s.kind == "flap")
        self._n_surf = self._n_fins + self._n_flaps
        # Inner-loop layout: [thr_centre, thr_inner, lean_x, lean_z] — the
        # embedded PD flies the gimbal, fins stay neutral (SLS-51; removes
        # the non-minimum-phase steering sub-problem from the policy).
        # Else: 4 group throttles (or 2 when landing-masked) + gimbal 2 + surfaces.
        if self.attitude_inner_loop:
            self.n_act = 4
        else:
            self.n_act = (2 if self.booster_landing_action else 4) + 2 + self._n_surf
        self._max_gimbal = next(
            (e.max_gimbal for e in self.vehicle.engines if e.can_gimbal), 0.0
        )
        self._full_prop = self.scenario.propellant_mass

    def set_vehicle(self, vehicle: C.Vehicle | None) -> None:
        """Override the plant (domain randomization). None restores nominal."""
        self._vehicle_override = vehicle
        self.vehicle = vehicle or C.VEHICLES[self.scenario.vehicle]

    def set_wind(self, wind: WindField | None) -> None:
        """Override the wind field (DR). None restores the scenario wind."""
        self._wind_override = wind
        self.wind = wind or build_wind(
            self.scenario.wind_spec or {"kind": "constant", "value": [0, 0, 0]}
        )

    def set_stage(
        self,
        scenario_id: str | None = None,
        start_alt_range: tuple[float, float] | dict | None = None,
    ) -> None:
        """Curriculum promotion hook — applies to subsequent resets."""
        if scenario_id is not None and scenario_id != self.scenario_id:
            self._configure_scenario(scenario_id)
        self.start_alt_range = start_alt_range

    # -- observation ----------------------------------------------------------

    def _obs(self) -> np.ndarray:
        w = self.world
        fuel = w.propellant_mass / self._full_prop if self._full_prop > 0 else 0.0
        tower_rel = w.position - self.scenario.target_position
        obs = np.concatenate(
            [
                w.position,
                w.velocity,
                w.attitude,
                w.angular_velocity,
                np.array([fuel]),
                tower_rel,
            ]
        ).astype(np.float64)
        if self.obs_noise_scale > 0:
            obs = obs + self.np_random.normal(0.0, 1.0, 17) * (
                OBS_NOISE_SIGMA * self.obs_noise_scale
            )
        if self.normalize_obs:
            obs = obs / OBS_SCALE
        return obs

    # -- action decoding ------------------------------------------------------

    def _decode(self, action: np.ndarray) -> ControlInput:
        a = np.clip(np.asarray(action, dtype=np.float64), -1.0, 1.0)
        # Null action (0) = null actuation: a <= 0 means engines OFF, a in
        # (0, 1] maps to throttle (0, 1]. The previous (a+1)/2 mapping put the
        # newborn policy at 50 % throttle (TWR 2.6) — born as an unstabilised
        # inverted pendulum, tumbling in every rollout (SLS-29 diagnostic).
        # Freefall is the aerodynamically stable mode; thrust is opt-in.
        if self.booster_landing_action:
            # [thr_centre, thr_inner, gp, gy, surfaces...] — outer/ship off.
            throttles = np.array([max(0.0, a[0]), max(0.0, a[1]), 0.0, 0.0])
            engines_on = {
                "centre": bool(throttles[0] > 0.02),
                "inner": bool(throttles[1] > 0.02),
                "outer": False,
                "ship": False,
            }
            gi = 2
        else:
            throttles = np.maximum(a[:4], 0.0)
            engines_on = {
                g: bool(throttles[i] > 0.02) for i, g in enumerate(_GROUPS)
            }
            gi = 4
        engine_groups = {g: float(throttles[i]) for i, g in enumerate(_GROUPS)}
        max_gimbal = next(
            (e.max_gimbal for e in self.vehicle.engines if e.can_gimbal), 0.0
        )
        gimbal_pitch = float(a[gi]) * max_gimbal
        gimbal_yaw = float(a[gi + 1]) * max_gimbal
        surf = a[gi + 2 : gi + 2 + self._n_surf]
        fins = np.zeros(self._n_fins)
        flaps = np.zeros(self._n_flaps)
        fi = ci = 0
        for k, s in enumerate(self.vehicle.surfaces):
            val = float(surf[k]) * s.max_deflection if k < len(surf) else 0.0
            if s.kind == "grid_fin":
                fins[fi] = val
                fi += 1
            else:
                flaps[ci] = val
                ci += 1
        return ControlInput(
            engine_groups=engine_groups,
            engines_on=engines_on,
            gimbal_pitch=gimbal_pitch,
            gimbal_yaw=gimbal_yaw,
            fins=fins,
            flaps=flaps,
        )

    def _throttle_sum(self, action: np.ndarray) -> float:
        n = 2 if (self.booster_landing_action or self.attitude_inner_loop) else 4
        return float(np.clip(np.asarray(action)[:n], 0, 1).sum())

    # -- reward + termination -------------------------------------------------

    def _potential(self, w: World) -> float:
        """Shaping potential Φ(s): higher (less negative) when near the target,
        on a sane descent profile, and upright. Potential-based (function of
        state only) so the optimal policy is unchanged.

        The vertical term tracks a REFERENCE DESCENT PROFILE, not |vy|:
        rewarding |vy|→0 unconditionally paid the policy to thrust into an
        ascent (the transient reward lands inside GAE's credit window, the
        doom 400 steps later does not — SLS-29 diagnostic). Under profile
        tracking, ascending is immediately expensive and freefalling past
        the profile is too — the funnel points at the catch."""
        sc = self.scenario
        dist = float(np.linalg.norm(w.position - sc.target_position))
        vh = math.hypot(float(w.velocity[0]), float(w.velocity[2]))
        omega = float(np.linalg.norm(w.angular_velocity))
        alt_above = float(w.position[1]) - float(sc.target_position[1])
        # gentle near the tower (2 m/s), up to 90 m/s high up
        vy_ref = -min(max(0.06 * alt_above, 2.0), 90.0)
        vy_err = abs(float(w.velocity[1]) - vy_ref)
        return -(
            W_POS * dist
            + W_VSPEED * vy_err
            + W_HSPEED * vh
            + W_TILT * _tilt_rad(w.attitude)
            + W_OMEGA * omega
        )

    def _caught(self, w: World) -> bool:
        sc = self.scenario
        if not C.CAPTURE_VOLUME.contains(w.position):
            return False
        dist = float(np.linalg.norm(w.position - sc.target_position))
        vh = math.hypot(float(w.velocity[0]), float(w.velocity[2]))
        omega = float(np.linalg.norm(w.angular_velocity))
        return (
            dist <= sc.position_tol_m
            and abs(float(w.velocity[1])) <= sc.vertical_speed_tol_mps
            and vh <= sc.horizontal_speed_tol_mps
            and _tilt_rad(w.attitude) <= sc.attitude_tilt_tol_rad
            and omega <= sc.angular_rate_tol_rad_per_s
        )

    def _miss_score(self, w: World) -> float:
        """How far (in envelope-normalised units) the state is from catchable:
        0 = inside every tolerance; each unit ≈ one full tolerance of error.
        Used to grade terminal failures so 'crashed slow, close, upright'
        outscores 'ballistic into the ground 3 km away'."""
        sc = self.scenario
        dist = float(np.linalg.norm(w.position - sc.target_position))
        vh = math.hypot(float(w.velocity[0]), float(w.velocity[2]))
        return (
            max(0.0, dist / sc.position_tol_m - 1.0)
            + max(0.0, abs(float(w.velocity[1])) / sc.vertical_speed_tol_mps - 1.0)
            + max(0.0, vh / sc.horizontal_speed_tol_mps - 1.0)
            + max(0.0, _tilt_rad(w.attitude) / sc.attitude_tilt_tol_rad - 1.0)
            + max(
                0.0,
                float(np.linalg.norm(w.angular_velocity))
                / sc.angular_rate_tol_rad_per_s
                - 1.0,
            )
        )

    def _terminal(self, w: World) -> tuple[bool, str]:
        if self._caught(w):
            return True, "caught"
        if C.CAPTURE_VOLUME.contains(w.position):
            return True, "near_miss"
        if C.TOWER_STRUCTURE.contains(w.position):
            return True, "tower_collision"
        if w.position[1] <= 0.0:
            return True, "crash"
        if w.propellant_mass <= 0.0:
            return True, "fuel_exhausted"
        # Escaped the flight envelope: flying up/away can never end in a
        # catch, and without this terminal a ~50 %-throttle policy just
        # leaves (TWR ≈ 2.6) and episodes burn 6000 steps of compute for a
        # state PPO's discounted objective already scores poorly. Graded
        # like every failure (miss score is huge out here → ≈ −R_FAIL).
        if w.position[1] > self._escape_alt or (
            math.hypot(
                float(w.position[0] - self.scenario.target_position[0]),
                float(w.position[2] - self.scenario.target_position[2]),
            )
            > self._escape_radius
        ):
            return True, "escaped"
        return False, "none"

    # -- gym API ---------------------------------------------------------------

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        if self.start_alt_range is not None:
            w = start_from_spec(self.scenario_id, self.start_alt_range, self.np_random)
        else:
            w = initial_world(self.scenario_id)
        jp = self.np_random.uniform(-1, 1, size=3) * self.position_jitter_m
        w.position = w.position + jp
        if self.velocity_jitter_mps > 0:
            w.velocity = w.velocity + self.np_random.uniform(-1, 1, size=3) * (
                self.velocity_jitter_mps
            )
        else:
            jv = 1.0 + self.np_random.uniform(-1, 1, size=3) * self.velocity_jitter_frac
            w.velocity = w.velocity * jv
        # Recompute mass + inertia from the (possibly DR-perturbed) mass model.
        from .physics_np import current_inertia, current_mass

        mp = self.vehicle.mass_props
        w.mass = current_mass(mp, w.propellant_mass)
        w.inertia = current_inertia(mp, w.propellant_mass)

        # Flight-envelope bounds relative to the start state (see _terminal).
        self._escape_alt = float(w.position[1]) + 2_000.0
        start_h = math.hypot(
            float(w.position[0] - self.scenario.target_position[0]),
            float(w.position[2] - self.scenario.target_position[2]),
        )
        self._escape_radius = start_h + 3_000.0

        self.wind.reset(self.np_random)
        self.world = w
        self.steps = 0
        self._prev_phi = self._potential(w)
        return self._obs(), {"phase": "descent"}

    def _inner_gimbal(self, control: ControlInput, lean_x, lean_z) -> None:
        """Close the PD attitude loop on the CURRENT world state, writing the
        gimbal command into `control` in place (250 Hz — hot path).

        The lean error is computed in the WORLD frame but the gimbal + rate
        feedback act in the BODY frame — the error must be rotated into the
        body frame first. (With uncontrolled roll drift the frames diverge;
        the mixed-frame version drifted vehicles sideways into the truss —
        SLS-51 trace.)"""
        from .mathx import quat_conjugate, quat_rotate

        q = self.world.attitude
        up = quat_rotate(q, _Y)
        e_world = np.array([lean_x - float(up[0]), 0.0, lean_z - float(up[2])])
        e_body = quat_rotate(quat_conjugate(q), e_world)
        wx = float(self.world.angular_velocity[0])
        wz = float(self.world.angular_velocity[2])
        control.gimbal_pitch = (
            max(-1.0, min(1.0, -K_ATT * float(e_body[2]) + K_RATE * wx))
            * self._max_gimbal
        )
        control.gimbal_yaw = (
            max(-1.0, min(1.0, +K_ATT * float(e_body[0]) + K_RATE * wz))
            * self._max_gimbal
        )

    def step(self, action):
        if self.attitude_inner_loop:
            a = np.clip(np.asarray(action, dtype=np.float64), -1.0, 1.0)
            thr = {
                "centre": float(max(0.0, a[0])),
                "inner": float(max(0.0, a[1])),
                "outer": 0.0,
                "ship": 0.0,
            }
            eng_on = {
                "centre": thr["centre"] > 0.02,
                "inner": thr["inner"] > 0.02,
                "outer": False,
                "ship": False,
            }
            lean_x = float(a[2]) * LEAN_MAX
            lean_z = float(a[3]) * LEAN_MAX
            control = ControlInput(
                engine_groups=thr,
                engines_on=eng_on,
                fins=np.zeros(self._n_fins),
                flaps=np.zeros(self._n_flaps),
            )
        else:
            control = self._decode(action)
        outcome = "none"
        terminated = False
        for _ in range(self.frame_skip):
            if self.attitude_inner_loop:
                self._inner_gimbal(control, lean_x, lean_z)
            wind_vec = self.wind.at(self.world.position, self.world.t)
            self.world = sim_step(
                self.world, self.vehicle, control, self.dt, _GRAVITY, wind=wind_vec
            )
            self.wind.step(self.dt)
            terminated, outcome = self._terminal(self.world)
            if terminated:
                break
        self.steps += 1

        phi = self._potential(self.world)
        shaping = self.gamma * phi - self._prev_phi
        self._prev_phi = phi
        reward = shaping - W_CTRL * self._throttle_sum(action)
        if terminated:
            if outcome == "caught":
                reward += R_CATCH
            else:
                # Graded failure: up to R_MISS_BONUS earned back by terminal
                # closeness-to-catchable. Ordering preserved: caught (+100)
                # >> best failure (−R_FAIL + R_MISS_BONUS = −40) > far crash
                # (→ −100). Terminal-only, so not farmable as a reward cycle.
                proximity = math.exp(-self._miss_score(self.world) / MISS_SOFTNESS)
                reward += -R_FAIL + R_MISS_BONUS * proximity

        truncated = self.steps >= self.max_episode_steps
        info = {"outcome": outcome, "fuel": self.world.propellant_mass}
        if terminated or truncated:
            info["success"] = outcome == "caught"
        return self._obs(), float(reward), terminated, truncated, info


def make_env(scenario_id: str = "booster-descent-calm", **kwargs):
    """Thunk factory for `gymnasium.vector` (AsyncVectorEnv / SyncVectorEnv)."""

    def _thunk():
        return StarshipCatchEnv(scenario_id=scenario_id, **kwargs)

    return _thunk
