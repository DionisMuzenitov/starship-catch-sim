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
 * Air density at a given altitude (m above sea level). Returns 0 (not NaN)
 * for negative altitudes — useful when a buggy controller momentarily
 * pushes the simulated position below the ground.
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
