import { describe, expect, it } from "vitest";

import { densityAt, machNumber, RHO0, speedOfSoundAt } from "./atmosphere.js";
import { bodyDragForce, cdAt } from "./drag.js";
import { Vec3 } from "./math/vec3.js";

describe("bodyDragForce", () => {
  it("zero velocity → zero force", () => {
    expect(bodyDragForce(Vec3.ZERO, 0, 10, 1.2)).toEqual(Vec3.ZERO);
  });

  it("force opposes velocity", () => {
    const v = Vec3.of(100, 0, 0);
    const f = bodyDragForce(v, 0, 10, 0.8);
    // -ve x because force opposes velocity. Orthogonal components are
    // exactly zero in magnitude — using toBeCloseTo to avoid the
    // -0 vs +0 strict-equality quirk in Object.is-based `toBe`.
    expect(f.x).toBeLessThan(0);
    expect(Math.abs(f.y)).toBeLessThan(1e-12);
    expect(Math.abs(f.z)).toBeLessThan(1e-12);
  });

  it("magnitude matches ½ ρ |v|² Cd A", () => {
    const v = Vec3.of(0, -200, 0);
    const cd = 0.8;
    const A = 10;
    const f = bodyDragForce(v, 0, A, cd);
    const speed2 = Vec3.lengthSquared(v);
    const expectedMag = 0.5 * RHO0 * speed2 * cd * A;
    expect(Vec3.length(f)).toBeCloseTo(expectedMag, 6);
  });

  it("scales with velocity squared", () => {
    const cd = 0.8;
    const A = 10;
    const f1 = bodyDragForce(Vec3.of(50, 0, 0), 0, A, cd);
    const f2 = bodyDragForce(Vec3.of(100, 0, 0), 0, A, cd);
    expect(Vec3.length(f2) / Vec3.length(f1)).toBeCloseTo(4, 6);
  });

  it("scales linearly with density (i.e. drag falls fast with altitude)", () => {
    const v = Vec3.of(100, 0, 0);
    const cd = 0.8;
    const A = 10;
    const fLow = bodyDragForce(v, 0, A, cd);
    const fHigh = bodyDragForce(v, 50_000, A, cd);
    const rhoRatio = densityAt(50_000) / RHO0;
    expect(Vec3.length(fHigh) / Vec3.length(fLow)).toBeCloseTo(rhoRatio, 6);
  });

  it("|drag| → 0 as altitude → ∞", () => {
    const v = Vec3.of(100, 0, 0);
    const f = bodyDragForce(v, 300_000, 10, 0.8);
    expect(Vec3.length(f)).toBeLessThan(1e-6);
  });

  it("works on an arbitrary 3-D velocity vector", () => {
    const v = Vec3.of(30, -40, 0);
    const f = bodyDragForce(v, 5000, 10, 0.8);
    // Drag should be anti-parallel to v.
    const vHat = Vec3.normalize(v);
    const fHat = Vec3.normalize(f);
    expect(Vec3.dot(fHat, vHat)).toBeCloseTo(-1, 6);
  });
});

describe("cdAt — Mach-dependent drag coefficient (SLS-45)", () => {
  const CD_SUB = 0.7;

  it("equals the subsonic plateau below drag divergence (M < 0.6)", () => {
    expect(cdAt(0, CD_SUB)).toBeCloseTo(CD_SUB, 12);
    expect(cdAt(0.3, CD_SUB)).toBeCloseTo(CD_SUB, 12);
    expect(cdAt(0.6, CD_SUB)).toBeCloseTo(CD_SUB, 12);
  });

  it("rises through the transonic region to a broad peak near M 1.5", () => {
    const cdPeak = cdAt(1.5, CD_SUB);
    expect(cdPeak).toBeGreaterThan(CD_SUB * 1.7);
    // Blunt-body retrograde shape: the peak is a maximum, with the rise
    // already under way at M 0.9 and only mild decay after M 2.
    expect(cdAt(0.9, CD_SUB)).toBeGreaterThan(CD_SUB * 1.1);
    expect(cdAt(0.9, CD_SUB)).toBeLessThan(cdPeak);
    expect(cdAt(3, CD_SUB)).toBeLessThan(cdPeak);
  });

  it("decays mildly supersonic and clamps at the high-Mach tail", () => {
    let prev = cdAt(1.5, CD_SUB);
    for (const m of [2, 3, 5]) {
      const cur = cdAt(m, CD_SUB);
      expect(cur).toBeLessThanOrEqual(prev);
      prev = cur;
    }
    // Beyond the table the multiplier stays at the last value.
    expect(cdAt(8, CD_SUB)).toBeCloseTo(cdAt(5, CD_SUB), 12);
    // The asymptote stays well above the subsonic plateau — wave drag on a
    // blunt retrograde body never falls back to the subsonic value.
    expect(cdAt(8, CD_SUB)).toBeGreaterThan(1.4 * CD_SUB);
  });

  it("is continuous across breakpoints (no jumps > a few % of plateau)", () => {
    const eps = 1e-6;
    for (const m of [0.6, 0.9, 1.1, 1.5, 2, 3, 5]) {
      const below = cdAt(m - eps, CD_SUB);
      const above = cdAt(m + eps, CD_SUB);
      expect(Math.abs(above - below)).toBeLessThan(0.01 * CD_SUB);
    }
  });

  it("scales linearly with the plateau Cd", () => {
    expect(cdAt(1.05, 1.4)).toBeCloseTo(2 * cdAt(1.05, 0.7), 10);
  });
});

describe("bodyDragForce × Mach (SLS-45)", () => {
  it("supersonic drag is materially higher than the old constant-Cd value", () => {
    // Representative descent point: Mach 1.5 at 10 km — the booster passes
    // through this regime before the landing burn. The old model used
    // Cd = cdSubsonic at all speeds; the new one applies the peak
    // transonic multiplier (~1.8×).
    const alt = 10_000;
    const speed = 1.5 * speedOfSoundAt(alt);
    const v = Vec3.of(0, -speed, 0);
    const cdSub = 0.7;
    const A = 10;
    const f = bodyDragForce(v, alt, A, cdSub);
    const oldModelMag = 0.5 * densityAt(alt) * speed * speed * cdSub * A;
    expect(Vec3.length(f)).toBeGreaterThan(1.7 * oldModelMag);
  });

  it("subsonic drag is unchanged from the constant-Cd model", () => {
    const alt = 2_000;
    const v = Vec3.of(0, -150, 0);
    expect(machNumber(150, alt)).toBeLessThan(0.8);
    const cdSub = 0.7;
    const A = 10;
    const f = bodyDragForce(v, alt, A, cdSub);
    const oldModelMag = 0.5 * densityAt(alt) * 150 * 150 * cdSub * A;
    expect(Vec3.length(f)).toBeCloseTo(oldModelMag, 6);
  });
});
