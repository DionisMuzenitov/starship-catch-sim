/**
 * Pins the hand-mirrored terrain constants against the committed bake
 * manifest (SLS-57): a re-bake that changes encoding or level parameters
 * without updating `terrain/constants.ts` would silently skew every decoded
 * height/size — this makes that a red test instead.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HEIGHT_MIN_M, HEIGHT_RANGE_M, TERRAIN_LEVELS } from "./constants";

const manifestPath = join(
  __dirname,
  "../../../public/assets/terrain/manifest.json",
);

describe("terrain constants match the committed bake manifest", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    heightEncoding: { minM: number; rangeM: number };
    tiers: Record<string, { sizeM: number; bBytes?: number }>;
  };

  it("height encoding", () => {
    expect(manifest.heightEncoding.minM).toBe(HEIGHT_MIN_M);
    expect(manifest.heightEncoding.rangeM).toBe(HEIGHT_RANGE_M);
  });

  it("levels: sizes and baked variants", () => {
    expect(Object.keys(manifest.tiers).sort()).toEqual(
      TERRAIN_LEVELS.map((l) => l.key).slice().sort(),
    );
    for (const level of TERRAIN_LEVELS) {
      const tier = manifest.tiers[level.key];
      expect(tier.sizeM, level.key).toBe(level.sizeM);
      const hasB = (tier.bBytes ?? 0) > 0;
      expect(level.variants.includes("b"), `${level.key} variant b`).toBe(hasB);
    }
  });
});
