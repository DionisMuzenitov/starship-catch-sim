/**
 * Terrain level + height-encoding constants (SLS-57, ADR-018).
 *
 * These mirror `tools/assets/bake-terrain.mjs` (the source of truth) and the
 * committed `apps/web/public/assets/terrain/manifest.json`. A unit test
 * (`terrain-manifest.test.ts`) pins them against the manifest so a re-bake
 * with changed parameters can't silently skew the decode.
 */
export const HEIGHT_MIN_M = -16;
export const HEIGHT_RANGE_M = 112;

export type DrapeSource = "a" | "b";

export interface TerrainLevel {
  key: "l0" | "l1" | "near" | "wide";
  sizeM: number;
  /** which drape variants were baked for this level */
  variants: readonly DrapeSource[];
  /** stacked levels sit slightly above the coarser ones below them */
  yOffsetM: number;
}

/** Nested resolution pyramid, innermost (sharpest, at the catch site) last
 *  so it renders on top of the coarser levels. */
export const TERRAIN_LEVELS: readonly TerrainLevel[] = [
  { key: "wide", sizeM: 102_400, variants: ["a", "b"], yOffsetM: -3 },
  { key: "near", sizeM: 10_240, variants: ["a", "b"], yOffsetM: 0 },
  { key: "l1", sizeM: 5_120, variants: ["a"], yOffsetM: 0.06 },
  { key: "l0", sizeM: 1_280, variants: ["a"], yOffsetM: 0.12 },
];
