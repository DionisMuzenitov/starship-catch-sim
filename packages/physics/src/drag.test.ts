import { describe, expect, it } from "vitest";

import { densityAt, RHO0 } from "./atmosphere.js";
import { bodyDragForce } from "./drag.js";
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
