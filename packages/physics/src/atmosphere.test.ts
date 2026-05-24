import { describe, expect, it } from "vitest";

import {
  densityAt,
  H_RHO,
  P0,
  pressureAt,
  pressureRatio,
  RHO0,
} from "./atmosphere.js";

describe("atmosphere", () => {
  it("sea-level density equals RHO0", () => {
    expect(Math.abs(densityAt(0) - RHO0) / RHO0).toBeLessThan(1e-3);
  });

  it("sea-level pressure equals P0", () => {
    expect(Math.abs(pressureAt(0) - P0) / P0).toBeLessThan(1e-3);
  });

  it("density at one scale height drops by factor e", () => {
    const expected = RHO0 / Math.E;
    expect(Math.abs(densityAt(H_RHO) - expected) / expected).toBeLessThan(
      1e-6,
    );
  });

  it("density at 100 km is ~1e-5 × sea level (exponential model is approximate at high altitude)", () => {
    // Note: real Earth atmosphere at 100 km is ~5e-7 × sea level — the
    // pure exponential model with H = 8.5 km gives ~1e-5 × sea level,
    // which is the well-known limitation of the simple model. We assert
    // the model's actual behaviour, not reality. The sanity check is that
    // density falls by many orders of magnitude.
    const ratio = densityAt(100_000) / RHO0;
    expect(ratio).toBeLessThan(1e-4);
    expect(ratio).toBeGreaterThan(1e-6);
  });

  it("pressureRatio at sea level is 1 and monotone decreasing", () => {
    expect(pressureRatio(0)).toBeCloseTo(1, 6);
    let prev = pressureRatio(0);
    for (let h = 1000; h <= 50_000; h += 1000) {
      const r = pressureRatio(h);
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });

  it("pressureRatio approaches 0 at high altitude", () => {
    expect(pressureRatio(200_000)).toBeLessThan(1e-10);
  });

  it("negative altitude clamps to sea-level values", () => {
    expect(densityAt(-100)).toBe(RHO0);
    expect(pressureAt(-100)).toBe(P0);
  });
});
