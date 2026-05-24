import { describe, expect, it } from "vitest";

import { Vec3 } from "./math/vec3.js";
import {
  constantWind,
  drydenTurbulence,
  layeredWind,
  type WindField,
} from "./wind.js";

describe("constantWind", () => {
  it("returns the same vector everywhere, every time", () => {
    const w = constantWind(Vec3.of(3, 0, -2));
    expect(w.at(Vec3.of(0, 0, 0), 0)).toEqual(Vec3.of(3, 0, -2));
    expect(w.at(Vec3.of(100, 200, 300), 999)).toEqual(Vec3.of(3, 0, -2));
  });
});

describe("layeredWind", () => {
  it("rejects empty layer list", () => {
    expect(() => layeredWind([])).toThrow();
  });

  it("piecewise constant outside the layer range", () => {
    const w = layeredWind([
      { altitude: 1000, wind: Vec3.of(1, 0, 0) },
      { altitude: 5000, wind: Vec3.of(5, 0, 0) },
    ]);
    expect(w.at(Vec3.of(0, 0, 0), 0)).toEqual(Vec3.of(1, 0, 0));
    expect(w.at(Vec3.of(0, 10_000, 0), 0)).toEqual(Vec3.of(5, 0, 0));
  });

  it("linearly interpolates between layers", () => {
    const w = layeredWind([
      { altitude: 0, wind: Vec3.of(0, 0, 0) },
      { altitude: 1000, wind: Vec3.of(10, 0, 0) },
    ]);
    const mid = w.at(Vec3.of(0, 500, 0), 0);
    expect(mid.x).toBeCloseTo(5, 9);
  });

  it("handles unsorted input by sorting internally", () => {
    const w = layeredWind([
      { altitude: 1000, wind: Vec3.of(10, 0, 0) },
      { altitude: 0, wind: Vec3.of(0, 0, 0) },
    ]);
    expect(w.at(Vec3.of(0, 500, 0), 0).x).toBeCloseTo(5, 9);
  });
});

describe("drydenTurbulence", () => {
  const opts = {
    sigma: Vec3.of(1.5, 0.5, 1.5),
    tau: Vec3.of(2, 2, 2),
    seed: 42,
  };

  it("zero initial output and same seed produces identical sequences", () => {
    const a = drydenTurbulence(opts);
    const b = drydenTurbulence(opts);
    for (let i = 0; i < 20; i++) {
      const va = a.at(Vec3.ZERO, i * 0.1);
      const vb = b.at(Vec3.ZERO, i * 0.1);
      expect(va).toEqual(vb);
    }
  });

  it("different seeds diverge", () => {
    const a = drydenTurbulence({ ...opts, seed: 1 });
    const b = drydenTurbulence({ ...opts, seed: 2 });
    // Advance both by a few samples.
    for (let i = 0; i < 5; i++) {
      a.at(Vec3.ZERO, i * 0.1);
      b.at(Vec3.ZERO, i * 0.1);
    }
    const va = a.at(Vec3.ZERO, 10);
    const vb = b.at(Vec3.ZERO, 10);
    expect(va).not.toEqual(vb);
  });

  it("stationary variance approaches σ² over a long run", () => {
    const sigma = 2;
    const f = drydenTurbulence({
      sigma: Vec3.of(sigma, sigma, sigma),
      tau: Vec3.of(1, 1, 1),
      seed: 12345,
    });
    const N = 5000;
    let sx = 0;
    let sx2 = 0;
    for (let i = 0; i < N; i++) {
      const w = f.at(Vec3.ZERO, i * 0.05);
      sx += w.x;
      sx2 += w.x * w.x;
    }
    const mean = sx / N;
    const variance = sx2 / N - mean * mean;
    // Tolerate ~20% sample error on variance for this many samples.
    expect(Math.abs(mean)).toBeLessThan(0.5);
    expect(variance).toBeGreaterThan(sigma * sigma * 0.7);
    expect(variance).toBeLessThan(sigma * sigma * 1.3);
  });

  it("out-of-order time call returns cached state without advancing", () => {
    const f = drydenTurbulence(opts);
    f.at(Vec3.ZERO, 0); // initialise
    const v1 = f.at(Vec3.ZERO, 0.1);
    const v2 = f.at(Vec3.ZERO, 0.05); // earlier — should be a no-op
    expect(v2).toEqual(v1);
  });

  it("`WindField` types are interchangeable", () => {
    const fields: WindField[] = [
      constantWind(Vec3.of(1, 2, 3)),
      layeredWind([{ altitude: 0, wind: Vec3.of(0, 0, 0) }]),
      drydenTurbulence(opts),
    ];
    for (const f of fields) {
      const v = f.at(Vec3.ZERO, 0);
      expect(typeof v.x).toBe("number");
    }
  });
});
