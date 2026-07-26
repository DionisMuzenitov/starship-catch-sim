/**
 * Realistic Monte-Carlo dispersion (SLS-110, the "v2" methodology).
 *
 * The original `jitterInitialWorld` perturbed only position (±20 m — a
 * *touchdown* tolerance, not an entry corridor) and velocity (±5%), and every
 * run reused the same wind gust sequence (`drydenTurbulence({ seed: 42 })`).
 * A 100-seed sweep over that samples an artificially narrow distribution — the
 * runs are near-clones. This module widens the initial state to a
 * physically-grounded entry-corridor spread AND draws a fresh wind realization
 * per run, so 100 seeds genuinely sample 100 different returns.
 *
 * Grounding (Falcon-9 / launch-vehicle Monte-Carlo analogs — Super Heavy's own
 * budget is unpublished; see SLS-110 and the SLS-93 research note for sources:
 * Blackmore 2016, Saghafi & Khalilidelshad 2003, NASA Hanson & Beard, NASA
 * TM-4168 on per-run turbulence seeds). All 1σ, Gaussian.
 *
 * This lives in the EVAL layer on purpose: it is measurement methodology, not a
 * scenario definition. It does NOT touch the shipped scenarios, `rl_consts.json`,
 * or the interactive app — so parity and the trained policy are untouched; only
 * how we *measure* changes. The controllers are re-benched on it (v2 record);
 * the narrow-dispersion v1 record is retained for provenance.
 */

import {
  Quat,
  STANDARD_WIND_LAYERS,
  STORMY_WIND_LAYERS,
  Vec3,
  constantWind,
  currentInertia,
  currentMass,
  drydenTurbulence,
  layeredWind,
  type Scenario,
  type SimEnv,
  type WindField,
  type WindLayer,
  type World,
} from "@starship-catch-sim/physics";

import { gaussian, makeRng } from "./monteCarlo.js";

const DEG = Math.PI / 180;

/** Grounded 1σ dispersions (SLS-110). */
export const DISPERSION = {
  /** Horizontal (x, z) entry-position spread — hundreds of m, not the ±20 m
   *  touchdown tolerance. */
  posHorizM: 500,
  /** Vertical (y) entry-position spread. */
  posVertM: 200,
  /** Entry-velocity magnitude fraction. */
  velFrac: 0.02,
  /** Flight-path-angle / heading perturbation of the velocity vector. */
  fpaRad: 0.75 * DEG,
  /** Attitude perturbation per axis. */
  attRad: 3 * DEG,
  /** Body-rate perturbation per axis. */
  rateRadS: 3 * DEG,
  /** Residual-propellant fraction. */
  propFrac: 0.02,
  /** Per-run mean-wind offset per axis (surface ±2 m/s rising aloft → ~3 m/s). */
  windMeanMps: 3,
} as const;

// Independent RNG streams for the IC draw and the wind draw. The two salts are
// XOR-distant (high Hamming distance) so `IC_SALT ^ s` can never equal
// `WIND_SALT ^ s'` for any nearby seeds s, s' — that requires `s ^ s'` to equal
// `IC_SALT ^ WIND_SALT`, which is huge, whereas neighbouring seeds differ by a
// small XOR. (A one-bit gap here silently made run N's IC stream identical to
// run N±1's wind stream.)
const IC_SALT = 0x9e3779b1; // golden-ratio constant
const WIND_SALT = 0x85ebca77; // murmur mix constant — XOR-distant from IC_SALT

/**
 * A dispersed initial world for `seed` — deterministic in `seed`, distinct
 * across seeds. Perturbs position, velocity (magnitude + direction), attitude,
 * body rates, and residual propellant (recomputing the derived rigid-body mass
 * + inertia so they stay consistent, as `makeInitialWorld` does).
 */
export function dispersedInitialWorld(
  scenario: Scenario,
  seed: number,
  /** Scales every 1σ together — the width knob for the SLS-93 sweep. 1 = the
   *  full grounded corridor; e.g. 0.2 → 100 m position σ. Must stay within the
   *  sim's ~1–2 km fin-steering authority to leave a recoverable regime. */
  scale = 1,
): World {
  const rng = makeRng(IC_SALT ^ seed);
  const init = scenario.initialWorld;
  const rb = init.rigidBody;

  const position = Vec3.of(
    rb.position.x + scale * DISPERSION.posHorizM * gaussian(rng),
    rb.position.y + scale * DISPERSION.posVertM * gaussian(rng),
    rb.position.z + scale * DISPERSION.posHorizM * gaussian(rng),
  );

  // Velocity: scale the magnitude, then tilt the direction by a small
  // flight-path-angle + heading rotation.
  const speedScale = 1 + scale * DISPERSION.velFrac * gaussian(rng);
  const dirRot = Quat.fromEulerZYX(
    scale * DISPERSION.fpaRad * gaussian(rng),
    scale * DISPERSION.fpaRad * gaussian(rng),
    0,
  );
  const velocity = Vec3.scale(Quat.rotateVec3(dirRot, rb.velocity), speedScale);

  // Attitude: compose a small body-frame rotation onto the nominal.
  const dAtt = Quat.fromEulerZYX(
    scale * DISPERSION.attRad * gaussian(rng),
    scale * DISPERSION.attRad * gaussian(rng),
    scale * DISPERSION.attRad * gaussian(rng),
  );
  const attitude = Quat.normalize(Quat.multiply(rb.attitude, dAtt));

  const angularVelocity = Vec3.of(
    rb.angularVelocity.x + scale * DISPERSION.rateRadS * gaussian(rng),
    rb.angularVelocity.y + scale * DISPERSION.rateRadS * gaussian(rng),
    rb.angularVelocity.z + scale * DISPERSION.rateRadS * gaussian(rng),
  );

  // Residual propellant, clamped ≥ 0; refresh the derived mass + inertia.
  const massState = {
    ...init.mass,
    propellantMass: Math.max(
      0,
      init.mass.propellantMass * (1 + scale * DISPERSION.propFrac * gaussian(rng)),
    ),
  };

  return {
    ...init,
    rigidBody: {
      ...rb,
      position,
      velocity,
      attitude,
      angularVelocity,
      mass: currentMass(massState),
      inertia: currentInertia(massState),
    },
    mass: massState,
  };
}

// --- Per-run wind ---------------------------------------------------------
//
// The nominal layers come straight from the shipped scenario (single-sourced
// via `STANDARD_WIND_LAYERS` / `STORMY_WIND_LAYERS`), so the v2 bench can never
// drift from the wind the interactive app actually flies. This module only adds
// the v2-only pieces on top: a per-run mean offset and a per-run Dryden seed.

function sumWind(a: WindField, b: WindField): WindField {
  return { at: (p, t) => Vec3.add(a.at(p, t), b.at(p, t)) };
}

/** Offset every layer's mean wind by one per-run Gaussian draw per axis. */
function offsetLayers(layers: readonly WindLayer[], rng: () => number): WindLayer[] {
  const off = Vec3.of(
    DISPERSION.windMeanMps * gaussian(rng),
    0, // vertical mean wind is negligible; leave it
    DISPERSION.windMeanMps * gaussian(rng),
  );
  return layers.map((l) => ({ altitude: l.altitude, wind: Vec3.add(l.wind, off) }));
}

/**
 * A dispersed environment for `seed`: the scenario's nominal wind, but with a
 * per-run mean offset and a per-run turbulence realization (fresh Dryden seed),
 * so no two runs see the same gusts. Calm stays calm (its variation comes from
 * the initial state); Standard gains a light per-run turbulence it never had.
 */
export function dispersedEnv(scenario: Scenario, seed: number): SimEnv {
  const gravity = scenario.env.gravity;
  // Calm has no wind at all — skip the PRNG work.
  if (scenario.difficulty === "calm") {
    return { wind: constantWind(Vec3.ZERO), gravity };
  }
  const rng = makeRng(WIND_SALT ^ seed);
  const drydenSeed = (WIND_SALT ^ (seed * 0x9e3779b1)) | 0;

  // Wind is always fully per-run realized (this is the frozen-gust fix, and it
  // applies at every point of the IC-width sweep — the sweep varies the START,
  // not the weather).
  let wind: WindField;
  if (scenario.difficulty === "standard") {
    wind = sumWind(
      layeredWind(offsetLayers(STANDARD_WIND_LAYERS, rng)),
      drydenTurbulence({
        sigma: Vec3.of(2, 0.5, 2),
        tau: Vec3.of(2, 2, 2),
        seed: drydenSeed,
      }),
    );
  } else {
    wind = sumWind(
      layeredWind(offsetLayers(STORMY_WIND_LAYERS, rng)),
      drydenTurbulence({
        sigma: Vec3.of(6, 1, 6),
        tau: Vec3.of(2, 2, 2),
        seed: drydenSeed,
      }),
    );
  }
  return { wind, gravity };
}
