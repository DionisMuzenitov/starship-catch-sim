import { describe, expect, it } from "vitest";

import {
  densityAt,
  H_RHO,
  machNumber,
  P0,
  pressureAt,
  pressureRatio,
  RHO0,
  speedOfSoundAt,
  temperatureAt,
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

describe("temperature + speed of sound (SLS-45)", () => {
  it("sea-level ISA temperature is 288.15 K", () => {
    expect(temperatureAt(0)).toBeCloseTo(288.15, 6);
  });

  it("tropopause (11 km) is 216.65 K and isothermal to 20 km", () => {
    expect(temperatureAt(11_000)).toBeCloseTo(216.65, 6);
    expect(temperatureAt(15_000)).toBeCloseTo(216.65, 6);
    expect(temperatureAt(20_000)).toBeCloseTo(216.65, 6);
  });

  it("stratopause (47–51 km) sits at 270.65 K", () => {
    expect(temperatureAt(47_000)).toBeCloseTo(270.65, 6);
    expect(temperatureAt(51_000)).toBeCloseTo(270.65, 6);
  });

  it("negative altitude clamps to sea level; model top clamps at 186.946 K", () => {
    expect(temperatureAt(-500)).toBeCloseTo(288.15, 6);
    expect(temperatureAt(84_852)).toBeCloseTo(186.946, 3);
    expect(temperatureAt(120_000)).toBeCloseTo(186.946, 3);
  });

  it("speed of sound is ~340.3 m/s at sea level, ~295.1 m/s at 11 km", () => {
    expect(speedOfSoundAt(0)).toBeCloseTo(340.3, 1);
    expect(speedOfSoundAt(11_000)).toBeCloseTo(295.1, 1);
  });

  it("temperature is continuous across every layer boundary", () => {
    for (const h of [11_000, 20_000, 32_000, 47_000, 51_000, 71_000]) {
      expect(temperatureAt(h - 0.5)).toBeCloseTo(temperatureAt(h + 0.5), 2);
    }
  });

  it("machNumber = speed / a(h)", () => {
    const a = speedOfSoundAt(10_000);
    expect(machNumber(a, 10_000)).toBeCloseTo(1, 9);
    expect(machNumber(2 * a, 10_000)).toBeCloseTo(2, 9);
    expect(machNumber(0, 10_000)).toBe(0);
  });
});
