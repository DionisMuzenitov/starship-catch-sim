"""Domain randomization for `StarshipCatchEnv` (SLS-29).

Per-episode perturbations (drawn at `reset`) so the trained policy transfers
across the disturbance envelope rather than overfitting one plant:

- dry mass ±5 %
- engine thrust ±5 % (vac+sea, one factor), Isp ±2 %
- engine response τ (throttle + gimbal) ±20 %
- wind layer means ±5 m/s per axis, turbulence intensity ×[0.5, 2]
- Gaussian sensor noise on the observation (env `obs_noise_scale`)
- initial state: position ±200 m, velocity ±20 m/s

Perturbed plants are fresh frozen `Vehicle` instances built with
`dataclasses.replace`; the batched-physics pack cache re-packs per episode
(~100 µs — negligible against a >10 s episode).
"""

from __future__ import annotations

from dataclasses import replace

import gymnasium as gym
import numpy as np

from . import consts as C
from .wind_np import build_wind


class DRConfig:
    def __init__(
        self,
        mass_frac: float = 0.05,
        thrust_frac: float = 0.05,
        isp_frac: float = 0.02,
        tau_frac: float = 0.20,
        wind_offset_mps: float = 5.0,
        turbulence_range: tuple[float, float] = (0.5, 2.0),
        obs_noise_scale: float = 1.0,
        position_jitter_m: float = 200.0,
        velocity_jitter_mps: float = 20.0,
    ):
        self.mass_frac = mass_frac
        self.thrust_frac = thrust_frac
        self.isp_frac = isp_frac
        self.tau_frac = tau_frac
        self.wind_offset_mps = wind_offset_mps
        self.turbulence_range = turbulence_range
        self.obs_noise_scale = obs_noise_scale
        self.position_jitter_m = position_jitter_m
        self.velocity_jitter_mps = velocity_jitter_mps


def perturb_vehicle(base: C.Vehicle, rng: np.random.Generator, cfg: DRConfig) -> C.Vehicle:
    """A fresh Vehicle with per-episode plant perturbations. One factor per
    quantity (all engines share it — a vehicle-level bias, not per-engine
    noise, matching how real dispersions are specified)."""
    u = lambda f: 1.0 + rng.uniform(-f, f)  # noqa: E731
    thrust_k = u(cfg.thrust_frac)
    isp_k = u(cfg.isp_frac)
    tau_thr_k = u(cfg.tau_frac)
    tau_gim_k = u(cfg.tau_frac)
    mass_k = u(cfg.mass_frac)

    engines = tuple(
        replace(
            e,
            thrust_vac=e.thrust_vac * thrust_k,
            thrust_sea=e.thrust_sea * thrust_k,
            isp_vac=e.isp_vac * isp_k,
            isp_sea=e.isp_sea * isp_k,
            tau_throttle=e.tau_throttle * tau_thr_k,
            tau_gimbal=e.tau_gimbal * tau_gim_k,
        )
        for e in base.engines
    )
    mass_props = replace(
        base.mass_props,
        dry_mass=base.mass_props.dry_mass * mass_k,
        dry_inertia=base.mass_props.dry_inertia * mass_k,
    )
    return replace(base, engines=engines, mass_props=mass_props)


class DomainRandomizationWrapper(gym.Wrapper):
    """Applies the DR spec before every episode. Draws from its own generator
    (seeded via `reset(seed=...)`) so DR is reproducible under gym seeding."""

    def __init__(self, env: gym.Env, config: DRConfig | None = None):
        super().__init__(env)
        self.cfg = config or DRConfig()
        self._rng = np.random.default_rng(0)

    def reset(self, *, seed=None, options=None):
        if seed is not None:
            self._rng = np.random.default_rng(seed)
        e = self.env.unwrapped
        base_vehicle = C.VEHICLES[e.scenario.vehicle]
        e.set_vehicle(perturb_vehicle(base_vehicle, self._rng, self.cfg))

        spec = e.scenario.wind_spec or {"kind": "constant", "value": [0, 0, 0]}
        offset = self._rng.uniform(-1, 1, 3) * self.cfg.wind_offset_mps
        turb = float(self._rng.uniform(*self.cfg.turbulence_range))
        e.set_wind(build_wind(spec, layer_offset=offset, turbulence_scale=turb))

        e.obs_noise_scale = self.cfg.obs_noise_scale
        # IC jitter must not swamp the curriculum stage: the ticket's ±200 m /
        # ±20 m/s was specified for full-descent starts (65 km). On a corridor
        # stage whose own lateral spread is ~25-400 m, a 200 m jitter throws
        # starts behind the tower or below the capture box — the SLS-51 BC
        # collection measured teacher catches at 5/150 with the flat jitter
        # vs 6/6 clean. Scale the jitter to the stage's start spec.
        spec = e.start_alt_range
        if isinstance(spec, dict):  # corridor: spec already randomizes
            lateral = float(spec.get("lateral", 100.0))
            e.position_jitter_m = min(self.cfg.position_jitter_m, 0.5 * lateral)
            e.velocity_jitter_mps = min(self.cfg.velocity_jitter_mps, 5.0)
        else:  # ballistic band or full-scenario start: full ticket spec
            e.position_jitter_m = self.cfg.position_jitter_m
            e.velocity_jitter_mps = self.cfg.velocity_jitter_mps

        return self.env.reset(seed=seed, options=options)
