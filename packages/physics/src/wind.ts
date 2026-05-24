/**
 * Wind / turbulence model.
 *
 * A `WindField` returns the wind vector (m/s, world frame) at a given
 * world-frame position and simulation time. The drag computation should use
 * `v_relative = v_world − wind.at(pos, t)` rather than `v_world` directly.
 *
 * Implementations provided:
 *  - `constantWind(v)` — uniform wind everywhere
 *  - `layeredWind(layers)` — piecewise-linear interpolation across altitudes
 *  - `drydenTurbulence({sigma, tau, seed})` — discrete Ornstein–Uhlenbeck
 *    approximation of the Dryden model, three independent axes, seeded
 *    PRNG for determinism. Stateful: each `at` call advances internal state.
 *
 * Per ADR-004 this module has no external dependencies — the PRNG is a
 * tiny inline mulberry32.
 */

import { Vec3 } from "./math/vec3.js";

export type WindField = {
  at(position: Vec3, time: number): Vec3;
};

// ---------------------------------------------------------------------------
// constantWind
// ---------------------------------------------------------------------------

export function constantWind(v: Vec3): WindField {
  return { at: () => v };
}

// ---------------------------------------------------------------------------
// layeredWind
// ---------------------------------------------------------------------------

export type WindLayer = {
  readonly altitude: number; // m, world-frame y
  readonly wind: Vec3; // m/s
};

export function layeredWind(layers: readonly WindLayer[]): WindField {
  if (layers.length === 0) {
    throw new Error("layeredWind: needs at least one layer");
  }
  const sorted = [...layers].sort((a, b) => a.altitude - b.altitude);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  return {
    at(position) {
      const h = position.y;
      if (h <= first.altitude) return first.wind;
      if (h >= last.altitude) return last.wind;
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i]!;
        const b = sorted[i + 1]!;
        if (h <= b.altitude) {
          const t = (h - a.altitude) / (b.altitude - a.altitude);
          return Vec3.lerp(a.wind, b.wind, t);
        }
      }
      // Unreachable given the bounds checks above.
      return last.wind;
    },
  };
}

// ---------------------------------------------------------------------------
// drydenTurbulence
// ---------------------------------------------------------------------------

/** Deterministic non-cryptographic PRNG, returns uniform `[0, 1)`. */
function mulberry32(seed: number): () => number {
  let t = seed | 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Box–Muller transform on a uniform `[0,1)` PRNG. */
function makeGaussian(rng: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u: number;
    do {
      u = rng();
    } while (u === 0);
    const v = rng();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
}

export type DrydenOpts = {
  /** Standard deviation of wind perturbation per axis (m/s). */
  readonly sigma: Vec3;
  /** Time constant per axis (s). */
  readonly tau: Vec3;
  /** Seed for the PRNG. */
  readonly seed: number;
};

/**
 * Discrete Ornstein–Uhlenbeck approximation of Dryden turbulence: each
 * component is an AR(1) process whose stationary variance equals `σ²` and
 * whose 1/e autocorrelation time is `τ`. Three independent axes.
 *
 * State is mutated in place across calls. Calls must arrive with
 * monotonically non-decreasing `time`; out-of-order calls return the
 * cached last value without advancing state.
 */
export function drydenTurbulence(opts: DrydenOpts): WindField {
  const gauss = makeGaussian(mulberry32(opts.seed));
  let state: Vec3 = Vec3.ZERO;
  let lastTime: number | null = null;

  const stepAxis = (
    cur: number,
    sigma: number,
    tau: number,
    dt: number,
  ): number => {
    if (tau <= 0 || dt <= 0) return cur;
    const decay = Math.exp(-dt / tau);
    const noiseScale = sigma * Math.sqrt(1 - decay * decay);
    return decay * cur + noiseScale * gauss();
  };

  return {
    at(_position, time) {
      if (lastTime === null) {
        lastTime = time;
        return state;
      }
      const dt = time - lastTime;
      if (dt <= 0) return state;
      lastTime = time;
      state = {
        x: stepAxis(state.x, opts.sigma.x, opts.tau.x, dt),
        y: stepAxis(state.y, opts.sigma.y, opts.tau.y, dt),
        z: stepAxis(state.z, opts.sigma.z, opts.tau.z, dt),
      };
      return state;
    },
  };
}
