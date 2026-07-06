/**
 * Simple exponential atmosphere — good enough for V1 of the simulator.
 *
 * `density` and `pressure` decay with their own scale heights so that both
 * the sea-level values and the high-altitude tail are close enough to the
 * International Standard Atmosphere (ISA) for our purposes. We are not
 * modelling temperature inversions, layered ICAO regions, or wind.
 *
 * Refs:
 * - U.S. Standard Atmosphere 1976 (the de-facto ISA).
 * - Wikipedia: "Scale height" — typical Earth scale height ≈ 8.5 km for
 *   density, ≈ 7.4 km for pressure.
 *
 * Per ADR-004 this module has no external dependencies.
 */

/** Sea-level air density (kg/m³). */
export const RHO0 = 1.225;

/** Sea-level air pressure (Pa). */
export const P0 = 101_325;

/** Scale height for density (m). */
export const H_RHO = 8_500;

/** Scale height for pressure (m). */
export const H_P = 7_400;

/**
 * Air density at a given altitude (m above sea level). Clamps to the
 * sea-level value (not NaN) for negative altitudes — useful when a buggy
 * controller momentarily pushes the simulated position below the ground.
 */
export function densityAt(altitudeM: number): number {
  if (altitudeM < 0) return RHO0;
  return RHO0 * Math.exp(-altitudeM / H_RHO);
}

/** Air pressure at altitude (Pa). Mirrors `densityAt`. */
export function pressureAt(altitudeM: number): number {
  if (altitudeM < 0) return P0;
  return P0 * Math.exp(-altitudeM / H_P);
}

/**
 * Pressure ratio p(h) / p(0), in [0, 1]. Useful for blending sea-level vs
 * vacuum thrust in the engine model.
 */
export function pressureRatio(altitudeM: number): number {
  return pressureAt(altitudeM) / P0;
}

// ---------------------------------------------------------------------------
// Temperature + speed of sound (SLS-45).
//
// Density/pressure above stay exponential (v1 approximation), but Mach
// number needs a temperature profile: the exponential model has none. We
// use the ISA / U.S. Standard Atmosphere 1976 layer temperatures directly.
// The slight inconsistency (ISA temperature alongside exponential density)
// is acceptable: Cd(M) only needs Mach to ~±0.05, and the exponential
// density is within ~10 % of ISA below 50 km where drag matters.
//
// Refs:
// - U.S. Standard Atmosphere 1976 (NASA-TM-X-74335): layer base altitudes,
//   base temperatures, lapse rates.
// - a = sqrt(γ·R·T), γ = 1.4, R = 287.05 J/(kg·K) for dry air.
// ---------------------------------------------------------------------------

/** Ratio of specific heats for dry air. Exported so the RL numpy port's
 * constants generator can single-source it (SLS-28 / R1). */
export const GAMMA_AIR = 1.4;

/** Specific gas constant for dry air (J/(kg·K)). */
export const R_AIR = 287.05;

/**
 * ISA layers up to 86 km (geopotential): [base altitude m, base temperature
 * K, lapse rate K/m]. Above the last base the temperature is held constant —
 * fine for our purposes; the booster never exceeds ~70 km.
 *
 * Exported for the RL constants generator (SLS-28 / R1) — the numpy port
 * consumes these verbatim via the generated JSON rather than a hand copy.
 */
export const ISA_LAYERS: readonly (readonly [number, number, number])[] = [
  [0, 288.15, -0.0065],
  [11_000, 216.65, 0],
  [20_000, 216.65, 0.001],
  [32_000, 228.65, 0.0028],
  [47_000, 270.65, 0],
  [51_000, 270.65, -0.0028],
  [71_000, 214.65, -0.002],
  [84_852, 186.946, 0],
];

/**
 * ISA air temperature (K) at a geometric altitude (m). Clamped to the
 * sea-level value below 0 and to the 84.852 km value above the model top.
 * (We ignore the geometric↔geopotential distinction: < 1 % below 60 km.)
 */
export function temperatureAt(altitudeM: number): number {
  const h = Math.max(0, altitudeM);
  let layer = ISA_LAYERS[0]!;
  for (const candidate of ISA_LAYERS) {
    if (candidate[0] > h) break;
    layer = candidate;
  }
  const [base, t0, lapse] = layer;
  return t0 + lapse * (h - base);
}

/** Speed of sound (m/s) at altitude: a = sqrt(γ·R·T(h)). */
export function speedOfSoundAt(altitudeM: number): number {
  return Math.sqrt(GAMMA_AIR * R_AIR * temperatureAt(altitudeM));
}

/** Mach number for a given airspeed (m/s) at altitude (m). */
export function machNumber(speedMps: number, altitudeM: number): number {
  return speedMps / speedOfSoundAt(altitudeM);
}
