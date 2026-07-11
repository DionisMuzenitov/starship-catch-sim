/**
 * Terrain tier + height-encoding constants (SLS-57, ADR-018).
 *
 * These mirror `tools/assets/bake-terrain.mjs` (the source of truth) and the
 * committed `apps/web/public/assets/terrain/manifest.json`. A unit test
 * (`terrain-manifest.test.ts`) pins them against the manifest so a re-bake
 * with changed parameters can't silently skew the decode.
 */
export const HEIGHT_MIN_M = -16;
export const HEIGHT_RANGE_M = 112;
export const NEAR_SIZE_M = 10_240;
export const WIDE_SIZE_M = 102_400;
