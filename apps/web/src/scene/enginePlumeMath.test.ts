import { describe, expect, it } from "vitest";

import {
  PLUME_MIN_THROTTLE,
  PLUME_VACUUM_ALT_M,
  plumeDims,
  plumeFlicker,
  plumeIntensity,
  seaLevelFactor,
} from "./enginePlumeMath";

describe("plumeIntensity", () => {
  it("is zero when the engine is off, whatever the throttle", () => {
    expect(plumeIntensity({ on: false, throttle: 1 })).toBe(0);
    expect(plumeIntensity({ on: false, throttle: 0 })).toBe(0);
  });

  it("is zero below the min-throttle floor but positive above it", () => {
    expect(plumeIntensity({ on: true, throttle: PLUME_MIN_THROTTLE / 2 })).toBe(
      0,
    );
    expect(
      plumeIntensity({ on: true, throttle: PLUME_MIN_THROTTLE * 2 }),
    ).toBeGreaterThan(0);
  });

  it("passes a low coast burn through as a small-but-visible intensity", () => {
    // The policy's coast uses a low centre burn — it must still show a flame.
    const i = plumeIntensity({ on: true, throttle: 0.05 });
    expect(i).toBeCloseTo(0.05, 6);
  });

  it("clamps to [0,1]", () => {
    expect(plumeIntensity({ on: true, throttle: 1.5 })).toBe(1);
  });
});

describe("seaLevelFactor", () => {
  it("is 1 at/below MSL and 0 at the vacuum altitude", () => {
    expect(seaLevelFactor(0)).toBe(1);
    expect(seaLevelFactor(-50)).toBe(1);
    expect(seaLevelFactor(PLUME_VACUUM_ALT_M)).toBe(0);
    expect(seaLevelFactor(PLUME_VACUUM_ALT_M * 2)).toBe(0);
  });

  it("decreases monotonically with altitude", () => {
    expect(seaLevelFactor(1000)).toBeGreaterThan(seaLevelFactor(10_000));
  });
});

describe("plumeDims", () => {
  it("collapses to nothing at zero intensity", () => {
    expect(plumeDims(0, 1)).toEqual({ length: 0, radius: 0, brightness: 0 });
  });

  it("grows length + radius with throttle", () => {
    const half = plumeDims(0.5, 1);
    const full = plumeDims(1, 1);
    expect(full.length).toBeGreaterThan(half.length);
    expect(full.radius).toBeGreaterThan(half.radius);
  });

  it("is longer + wider but fainter in vacuum than at sea level", () => {
    const sea = plumeDims(1, 1);
    const vac = plumeDims(1, 0);
    expect(vac.length).toBeGreaterThan(sea.length);
    expect(vac.radius).toBeGreaterThan(sea.radius);
    expect(vac.brightness).toBeLessThan(sea.brightness);
  });

  it("blooms at sea-level full throttle (brightness > 1)", () => {
    expect(plumeDims(1, 1).brightness).toBeGreaterThan(1);
  });

  it("clamps out-of-range intensity + regime", () => {
    expect(plumeDims(2, 2)).toEqual(plumeDims(1, 1));
  });
});

describe("plumeFlicker", () => {
  it("stays within ±8% of unity", () => {
    for (let t = 0; t < 10; t += 0.1) {
      for (let i = 0; i < 5; i++) {
        const f = plumeFlicker(t, i);
        expect(f).toBeGreaterThanOrEqual(0.84 - 1e-9);
        expect(f).toBeLessThanOrEqual(1.0 + 1e-9);
      }
    }
  });

  it("is deterministic in (time, engine index)", () => {
    expect(plumeFlicker(1.23, 4)).toBe(plumeFlicker(1.23, 4));
  });
});
