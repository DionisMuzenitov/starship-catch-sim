/**
 * Pins the hand-mirrored terrain constants against the committed bake
 * manifest (SLS-57): a re-bake that changes encoding or tier parameters
 * without updating `terrain/constants.ts` would silently skew every decoded
 * height/size — this makes that a red test instead.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HEIGHT_MIN_M, HEIGHT_RANGE_M, NEAR_SIZE_M, WIDE_SIZE_M } from "./constants";

const manifestPath = join(
  __dirname,
  "../../../public/assets/terrain/manifest.json",
);

describe("terrain constants match the committed bake manifest", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    heightEncoding: { minM: number; rangeM: number };
    tiers: { near: { sizeM: number }; wide: { sizeM: number } };
  };

  it("height encoding", () => {
    expect(manifest.heightEncoding.minM).toBe(HEIGHT_MIN_M);
    expect(manifest.heightEncoding.rangeM).toBe(HEIGHT_RANGE_M);
  });

  it("tier sizes", () => {
    expect(manifest.tiers.near.sizeM).toBe(NEAR_SIZE_M);
    expect(manifest.tiers.wide.sizeM).toBe(WIDE_SIZE_M);
  });
});
