"""`StarshipCatchEnv` — a Gymnasium env over the numpy physics port (SLS-28).

Observation (17-dim Box): position(3), velocity(3), attitude quaternion(4),
angular velocity(3), normalised fuel(1), tower-relative position(3).

Action (Box[-1,1], decoded then unnormalised): per-group throttles
(centre/inner/outer/ship), gimbal pitch/yaw, per-surface deflections.

Reward is potential-based shaping (Ng, Harada & Russell 1999) plus sparse
terminal bonuses and a control-effort penalty — see docs/rl-reward.md.

Physics runs at PHYSICS_DT (250 Hz); each env step applies one action for
`frame_skip` substeps (25 Hz control by default) so episodes stay a tractable
length for PPO (SLS-29). Wind is calm here; domain randomization is SLS-29.
"""

from __future__ import annotations

import math

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from . import consts as C
from .physics_np import ControlInput, World, initial_world, sim_step

_GROUPS = ("centre", "inner", "outer", "ship")
_GRAVITY = 9.80665

# Reward weights (see docs/rl-reward.md for the rationale).
GAMMA = 0.99
W_POS = 1.0e-3  # per metre of distance-to-target
W_VSPEED = 5.0e-3  # per m/s of vertical speed
W_HSPEED = 5.0e-3  # per m/s of horizontal speed
W_TILT = 0.2  # per rad of tilt from upright
R_CATCH = 100.0
R_FAIL = 100.0
W_CTRL = 1.0e-3  # per unit of summed throttle (fuel-efficiency nudge)


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
    ):
        super().__init__()
        self.scenario_id = scenario_id
        self.scenario = C.SCENARIOS[scenario_id]
        self.vehicle = C.VEHICLES[self.scenario.vehicle]
        self.frame_skip = frame_skip
        self.max_episode_steps = max_episode_steps
        self.position_jitter_m = position_jitter_m
        self.velocity_jitter_frac = velocity_jitter_frac
        self.dt = C.PHYSICS_DT

        self._n_fins = sum(1 for s in self.vehicle.surfaces if s.kind == "grid_fin")
        self._n_flaps = sum(1 for s in self.vehicle.surfaces if s.kind == "flap")
        self._n_surf = self._n_fins + self._n_flaps
        # 4 group throttles + gimbal pitch/yaw + per-surface deflections.
        self.n_act = 4 + 2 + self._n_surf

        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf, shape=(17,), dtype=np.float64
        )
        self.action_space = spaces.Box(
            low=-1.0, high=1.0, shape=(self.n_act,), dtype=np.float64
        )

        self._full_prop = self.scenario.propellant_mass
        self.world: World | None = None
        self.steps = 0

    # -- observation ---------------------------------------------------------

    def _obs(self) -> np.ndarray:
        w = self.world
        fuel = w.propellant_mass / self._full_prop if self._full_prop > 0 else 0.0
        tower_rel = w.position - self.scenario.target_position
        return np.concatenate(
            [
                w.position,
                w.velocity,
                w.attitude,
                w.angular_velocity,
                np.array([fuel]),
                tower_rel,
            ]
        ).astype(np.float64)

    # -- action decoding -----------------------------------------------------

    def _decode(self, action: np.ndarray) -> ControlInput:
        a = np.clip(np.asarray(action, dtype=np.float64), -1.0, 1.0)
        throttles = (a[:4] + 1.0) * 0.5  # [-1,1] -> [0,1]
        engine_groups = {g: float(throttles[i]) for i, g in enumerate(_GROUPS)}
        engines_on = {g: bool(throttles[i] > 0.05) for i, g in enumerate(_GROUPS)}
        # Gimbal scaled to the vehicle's gimbal limit (first gimballing engine).
        max_gimbal = next(
            (e.max_gimbal for e in self.vehicle.engines if e.can_gimbal), 0.0
        )
        gimbal_pitch = float(a[4]) * max_gimbal
        gimbal_yaw = float(a[5]) * max_gimbal
        surf = a[6 : 6 + self._n_surf]
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

    # -- reward + termination ------------------------------------------------

    def _potential(self, w: World) -> float:
        """Shaping potential Φ(s): higher (less negative) when near the target,
        slow, and upright. Potential-based so the optimal policy is unchanged."""
        sc = self.scenario
        dist = float(np.linalg.norm(w.position - sc.target_position))
        vh = math.hypot(float(w.velocity[0]), float(w.velocity[2]))
        return -(
            W_POS * dist
            + W_VSPEED * abs(float(w.velocity[1]))
            + W_HSPEED * vh
            + W_TILT * _tilt_rad(w.attitude)
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
        return False, "none"

    # -- gym API -------------------------------------------------------------

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        w = initial_world(self.scenario_id)
        jp = self.np_random.uniform(-1, 1, size=3) * self.position_jitter_m
        jv = 1.0 + self.np_random.uniform(-1, 1, size=3) * self.velocity_jitter_frac
        w.position = w.position + jp
        w.velocity = w.velocity * jv
        self.world = w
        self.steps = 0
        self._prev_phi = self._potential(w)
        return self._obs(), {"phase": "descent"}

    def step(self, action):
        control = self._decode(action)
        outcome = "none"
        terminated = False
        for _ in range(self.frame_skip):
            self.world = sim_step(
                self.world, self.vehicle, control, self.dt, _GRAVITY
            )
            terminated, outcome = self._terminal(self.world)
            if terminated:
                break
        self.steps += 1

        phi = self._potential(self.world)
        shaping = GAMMA * phi - self._prev_phi
        self._prev_phi = phi
        throttle_sum = float(np.clip((np.asarray(action)[:4] + 1.0) * 0.5, 0, 1).sum())
        reward = shaping - W_CTRL * throttle_sum
        if terminated:
            reward += R_CATCH if outcome == "caught" else -R_FAIL

        truncated = self.steps >= self.max_episode_steps
        info = {"outcome": outcome, "fuel": self.world.propellant_mass}
        return self._obs(), float(reward), terminated, truncated, info


def make_env(scenario_id: str = "booster-descent-calm", **kwargs):
    """Thunk factory for `gymnasium.vector` (AsyncVectorEnv / SyncVectorEnv)."""

    def _thunk():
        return StarshipCatchEnv(scenario_id=scenario_id, **kwargs)

    return _thunk
