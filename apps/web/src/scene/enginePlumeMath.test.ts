import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  PLUME_MIN_THROTTLE,
  PLUME_VACUUM_ALT_M,
  plumeDims,
  plumeFlicker,
  plumeIntensity,
  seaLevelFactor,
} from "./enginePlumeMath";

const unit = () => fc.double({ min: 0, max: 1, noNaN: true });
const altitude = () =>
  fc.double({ min: -2_000, max: 120_000, noNaN: true, noDefaultInfinity: true });
// An ordered pair a ≤ b, for monotonicity properties.
const ordered = (arb: () => fc.Arbitrary<number>) =>
  fc.tuple(arb(), arb()).map(([x, y]) => (x <= y ? [x, y] : [y, x]));

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

describe("plumeMath invariants (property)", () => {
  it("plumeIntensity: always in [0,1], zero when off, monotonic in throttle", () => {
    fc.assert(
      fc.property(fc.boolean(), unit(), (on, throttle) => {
        const i = plumeIntensity({ on, throttle });
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThanOrEqual(1);
        if (!on) expect(i).toBe(0);
      }),
    );
    fc.assert(
      fc.property(ordered(unit), ([lo, hi]) => {
        expect(plumeIntensity({ on: true, throttle: hi })).toBeGreaterThanOrEqual(
          plumeIntensity({ on: true, throttle: lo }),
        );
      }),
    );
  });

  it("seaLevelFactor: in [0,1] and monotonically non-increasing with altitude", () => {
    fc.assert(
      fc.property(altitude(), (a) => {
        const s = seaLevelFactor(a);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }),
    );
    fc.assert(
      fc.property(ordered(altitude), ([lo, hi]) => {
        expect(seaLevelFactor(hi)).toBeLessThanOrEqual(seaLevelFactor(lo));
      }),
    );
  });

  it("plumeDims: non-negative, and length/radius/brightness non-decreasing in intensity", () => {
    fc.assert(
      fc.property(unit(), unit(), (intensity, sea) => {
        const d = plumeDims(intensity, sea);
        expect(d.length).toBeGreaterThanOrEqual(0);
        expect(d.radius).toBeGreaterThanOrEqual(0);
        expect(d.brightness).toBeGreaterThanOrEqual(0);
      }),
    );
    fc.assert(
      fc.property(ordered(unit), unit(), ([lo, hi], sea) => {
        const a = plumeDims(lo, sea);
        const b = plumeDims(hi, sea);
        expect(b.length).toBeGreaterThanOrEqual(a.length);
        expect(b.radius).toBeGreaterThanOrEqual(a.radius);
        expect(b.brightness).toBeGreaterThanOrEqual(a.brightness);
      }),
    );
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
