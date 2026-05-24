/**
 * Raptor engine parameters — sea-level and vacuum variants.
 *
 * All numbers are **approximate** public estimates (SpaceX talks, Wikipedia)
 * and should be treated as gameplay constants, not engineering ground truth.
 *
 * Refs (browse 2026-05):
 * - SpaceX Raptor 3 specifications (publicly released figures).
 * - Wikipedia: "SpaceX Raptor" — Isp and thrust ranges across variants.
 */

const RAPTOR_TAU_THROTTLE = 0.15; // s — approximate first-order response
const RAPTOR_TAU_GIMBAL = 0.1; // s — fast gimbal actuation
const RAPTOR_MIN_THROTTLE = 0.4; // 40% deep throttle, public estimate
const RAPTOR_GIMBAL_LIMIT = 0.262; // rad — ~15° per public discussion
const RAPTOR_GIMBAL_RATE = 0.35; // rad/s — ~20°/s, conservative

/**
 * Common parameters that aren't mount/direction/gimbal-capable. A factory
 * helper builds the full `Engine` record once those vary across positions.
 */
export const RaptorSeaParams = {
  thrustVac: 2_300_000, // N
  thrustSea: 2_050_000, // N
  ispVac: 350, // s
  ispSea: 327, // s
  maxGimbal: RAPTOR_GIMBAL_LIMIT,
  maxGimbalRate: RAPTOR_GIMBAL_RATE,
  minThrottle: RAPTOR_MIN_THROTTLE,
  tauThrottle: RAPTOR_TAU_THROTTLE,
  tauGimbal: RAPTOR_TAU_GIMBAL,
} as const;

/** Vacuum-optimised Raptor: bigger nozzle, vacuum-only ignition profile. */
export const RaptorVacParams = {
  thrustVac: 2_500_000, // N — RVac is slightly more thrust in vac than SL Raptor
  thrustSea: 0, // not designed for sea-level operation
  ispVac: 380, // s — bigger expansion ratio
  ispSea: 0, // would be off-design and untrustworthy
  maxGimbal: 0,
  maxGimbalRate: 0,
  minThrottle: RAPTOR_MIN_THROTTLE,
  tauThrottle: RAPTOR_TAU_THROTTLE,
  tauGimbal: 0,
} as const;
