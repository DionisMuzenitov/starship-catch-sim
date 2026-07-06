"""Wind fields for the RL env (SLS-29) — numpy mirror of packages/physics wind.ts.

Two building blocks, matching the TS model *in distribution* (not bit-exact —
per ADR-013 the stateful Dryden PRNG is not part of the parity contract):

- `LayeredWind`: piecewise-linear interpolation of a wind vector by altitude.
- `OUTurbulence`: per-axis Ornstein-Uhlenbeck gusts (the Dryden-like model
  from wind.ts) — sigma = steady-state std (m/s), tau = correlation time (s).

Fields are stateful per episode; `reset(rng)` reseeds gusts from the env's
`np_random` so episodes are reproducible under Gymnasium seeding.
"""

from __future__ import annotations

import numpy as np


class WindField:
    """Interface: `at(position, t) -> (3,) wind vector`, `step(dt)`, `reset(rng)`."""

    def at(self, position: np.ndarray, t: float) -> np.ndarray:  # pragma: no cover
        raise NotImplementedError

    def step(self, dt: float) -> None:
        pass

    def reset(self, rng: np.random.Generator) -> None:
        pass


class CalmWind(WindField):
    def at(self, position, t):
        return np.zeros(3)


class LayeredWind(WindField):
    """Altitude-interpolated mean wind. layers: list of (altitude_m, (3,) wind)."""

    def __init__(self, layers: list[tuple[float, np.ndarray]]):
        self.alts = np.array([a for a, _ in layers], dtype=np.float64)
        self.winds = np.array([w for _, w in layers], dtype=np.float64)

    def at(self, position, t):
        h = float(position[1])
        out = np.empty(3)
        for k in range(3):
            out[k] = np.interp(h, self.alts, self.winds[:, k])
        return out


class OUTurbulence(WindField):
    """Ornstein-Uhlenbeck gust per axis: dx = -x/tau·dt + sigma·sqrt(2dt/tau)·N."""

    def __init__(self, sigma: np.ndarray, tau: np.ndarray):
        self.sigma = np.asarray(sigma, dtype=np.float64)
        self.tau = np.asarray(tau, dtype=np.float64)
        self.state = np.zeros(3)
        self.rng = np.random.default_rng(0)

    def reset(self, rng: np.random.Generator) -> None:
        self.rng = rng
        # Start from the stationary distribution, not zero.
        self.state = self.rng.normal(0.0, 1.0, 3) * self.sigma

    def step(self, dt: float) -> None:
        drift = -self.state / self.tau * dt
        diffusion = self.sigma * np.sqrt(2.0 * dt / self.tau)
        self.state = self.state + drift + diffusion * self.rng.normal(0.0, 1.0, 3)

    def at(self, position, t):
        return self.state


class CombinedWind(WindField):
    def __init__(self, *fields: WindField):
        self.fields = fields

    def at(self, position, t):
        out = np.zeros(3)
        for f in self.fields:
            out = out + f.at(position, t)
        return out

    def step(self, dt):
        for f in self.fields:
            f.step(dt)

    def reset(self, rng):
        for f in self.fields:
            f.reset(rng)


def build_wind(
    spec: dict,
    *,
    layer_offset: np.ndarray | None = None,
    turbulence_scale: float = 1.0,
) -> WindField:
    """Build a WindField from an rl_consts.json scenario wind spec.

    `layer_offset` shifts every layer's mean wind (domain randomization:
    ±5 m/s); `turbulence_scale` multiplies Dryden sigma (DR: ×[0.5, 2]).
    """
    kind = spec.get("kind", "constant")
    if kind == "constant":
        v = np.asarray(spec.get("value", [0, 0, 0]), dtype=np.float64)
        if layer_offset is not None:
            v = v + layer_offset
        if np.allclose(v, 0.0):
            return CalmWind()
        return LayeredWind([(0.0, v), (100_000.0, v)])

    layers = [
        (float(la["altitude"]), np.asarray(la["wind"], dtype=np.float64))
        for la in spec["layers"]
    ]
    if layer_offset is not None:
        layers = [(a, w + layer_offset) for a, w in layers]
    layered = LayeredWind(layers)

    dryden = spec.get("dryden")
    if kind == "combined" and dryden:
        sigma = np.asarray(dryden["sigma"], dtype=np.float64) * turbulence_scale
        tau = np.asarray(dryden["tau"], dtype=np.float64)
        return CombinedWind(layered, OUTurbulence(sigma, tau))
    return layered
