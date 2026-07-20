/**
 * Pure plume math for the engine-plume VFX (SLS-60). No three.js / React —
 * just the throttle → shape/brightness curves, so they can be unit-tested and
 * the R3F component (`EnginePlumes.tsx`) stays a thin per-frame driver.
 *
 * A plume is a cone hanging off a nozzle at the engine plane, pointing down the
 * −Y body axis. Its length/width/brightness are driven by:
 *  - `intensity` ∈ [0,1]: the live engine throttle, zero when the engine is off.
 *  - `seaLevelFactor` ∈ [0,1]: 1 near sea level, 0 in vacuum. Rocket exhaust is
 *    a tight, bright, banded plume when the ambient pressure confines it (low
 *    altitude) and a wide, faint fan when it expands freely (vacuum) — see the
 *    two regimes grounded for SLS-60. We interpolate the cone between them.
 */

/** Live engine sample the plume reads (subset of physics `EngineState`). */
export type PlumeSample = { readonly on: boolean; readonly throttle: number };

/** Resolved plume geometry + look for one engine, in body-frame metres. */
export type PlumeDims = {
  /** Cone length down −Y (m). 0 ⇒ engine not plotting a plume this frame. */
  readonly length: number;
  /** Cone base radius at the tip (m). */
  readonly radius: number;
  /** Additive-colour multiplier; can exceed 1 to bloom. */
  readonly brightness: number;
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Below this throttle the engine plots no plume — an engine that is nominally
 * `on` but at zero/near-zero throttle (spooling, shutdown tail) shows nothing.
 * Kept tiny so the policy's low coast burn still shows a small flame (the
 * ticket calls that out explicitly).
 */
export const PLUME_MIN_THROTTLE = 0.01;

/** Altitude (m, body Y ≈ MSL) over which the plume relaxes from the confined
 *  sea-level regime to the free-expansion vacuum regime. */
export const PLUME_VACUUM_ALT_M = 40_000;

// Cone dimensions at FULL throttle, per regime (body-frame metres). Sea level:
// tight + short-ish + bright. Vacuum: long + wide + fainter. Real Raptor flame
// during the landing burn reads as tens of metres against the 71 m booster.
const LENGTH_SEA_M = 22;
const LENGTH_VAC_M = 55;
// Flame is noticeably wider than the ~1.3 m nozzle so a burn reads as a chunky
// column, and the clustered centre engines merge into one plume (owner feedback
// — the earlier 1.1 m looked too thin for the engine size).
const RADIUS_SEA_M = 2.2;
const RADIUS_VAC_M = 4.5;
const BRIGHT_SEA = 1.8; // >1 so the additive core blooms
const BRIGHT_VAC = 0.7;

/** Engine throttle as a plume intensity, gated on ignition. */
export function plumeIntensity(s: PlumeSample): number {
  if (!s.on) return 0;
  if (s.throttle < PLUME_MIN_THROTTLE) return 0;
  return clamp01(s.throttle);
}

/** Sea-level regime factor from body-frame altitude: 1 at/below MSL, easing to
 *  0 by `PLUME_VACUUM_ALT_M`. */
export function seaLevelFactor(altitudeM: number): number {
  return clamp01(1 - altitudeM / PLUME_VACUUM_ALT_M);
}

/**
 * Resolve a plume's length/radius/brightness. Length + radius scale linearly
 * with intensity (so throttle visibly modulates the flame and it vanishes at
 * zero); the sea↔vacuum regime sets the per-unit dimensions and brightness.
 */
export function plumeDims(intensity: number, seaLevel: number): PlumeDims {
  const i = clamp01(intensity);
  const sea = clamp01(seaLevel);
  if (i <= 0) return { length: 0, radius: 0, brightness: 0 };
  return {
    length: i * lerp(LENGTH_VAC_M, LENGTH_SEA_M, sea),
    radius: i * lerp(RADIUS_VAC_M, RADIUS_SEA_M, sea),
    brightness: i * lerp(BRIGHT_VAC, BRIGHT_SEA, sea),
  };
}

/**
 * Cheap per-engine brightness flicker so the flame looks alive without a
 * particle system. Deterministic in (time, engine index); returns 0.92 ± 0.08,
 * i.e. the range [0.84, 1.0] (a slight dimming flutter, never brighter).
 */
export function plumeFlicker(t: number, engineIndex: number): number {
  return 0.92 + 0.08 * Math.sin(t * 37 + engineIndex * 1.7);
}
