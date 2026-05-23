import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { Vec3 } from "./vec3.js";

const finiteNumber = () =>
  fc.double({
    min: -1e6,
    max: 1e6,
    noNaN: true,
    noDefaultInfinity: true,
  });

const vec3Arb = () =>
  fc.record({ x: finiteNumber(), y: finiteNumber(), z: finiteNumber() });

const nonZeroVec3Arb = () =>
  vec3Arb().filter((v) => Vec3.lengthSquared(v) > 1e-6);

describe("Vec3", () => {
  it("ZERO is (0,0,0)", () => {
    expect(Vec3.ZERO).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("of builds a vector", () => {
    expect(Vec3.of(1, 2, 3)).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("add", () => {
    expect(Vec3.add(Vec3.of(1, 2, 3), Vec3.of(4, 5, 6))).toEqual(
      Vec3.of(5, 7, 9),
    );
  });

  it("sub", () => {
    expect(Vec3.sub(Vec3.of(4, 5, 6), Vec3.of(1, 2, 3))).toEqual(
      Vec3.of(3, 3, 3),
    );
  });

  it("scale", () => {
    expect(Vec3.scale(Vec3.of(1, 2, 3), 2)).toEqual(Vec3.of(2, 4, 6));
  });

  it("negate", () => {
    expect(Vec3.negate(Vec3.of(1, -2, 3))).toEqual(Vec3.of(-1, 2, -3));
  });

  it("dot", () => {
    expect(Vec3.dot(Vec3.of(1, 2, 3), Vec3.of(4, 5, 6))).toBe(32);
  });

  it("cross of standard basis", () => {
    const x = Vec3.of(1, 0, 0);
    const y = Vec3.of(0, 1, 0);
    const z = Vec3.of(0, 0, 1);
    expect(Vec3.cross(x, y)).toEqual(z);
    expect(Vec3.cross(y, z)).toEqual(x);
    expect(Vec3.cross(z, x)).toEqual(y);
  });

  it("length and lengthSquared", () => {
    const v = Vec3.of(3, 4, 0);
    expect(Vec3.lengthSquared(v)).toBe(25);
    expect(Vec3.length(v)).toBe(5);
  });

  it("normalize of unit-ish vector", () => {
    const n = Vec3.normalize(Vec3.of(3, 0, 0));
    expect(Vec3.equals(n, Vec3.of(1, 0, 0))).toBe(true);
  });

  it("normalize of zero returns ZERO (no NaN)", () => {
    expect(Vec3.normalize(Vec3.ZERO)).toEqual(Vec3.ZERO);
  });

  it("lerp midpoint", () => {
    const m = Vec3.lerp(Vec3.of(0, 0, 0), Vec3.of(2, 4, 6), 0.5);
    expect(Vec3.equals(m, Vec3.of(1, 2, 3))).toBe(true);
  });

  it("equals respects epsilon", () => {
    expect(
      Vec3.equals(Vec3.of(1, 1, 1), Vec3.of(1 + 1e-12, 1, 1), 1e-9),
    ).toBe(true);
    expect(Vec3.equals(Vec3.of(1, 1, 1), Vec3.of(1.01, 1, 1), 1e-9)).toBe(
      false,
    );
  });

  it("fromArray / toArray round-trip", () => {
    const arr: [number, number, number] = [1, 2, 3];
    expect(Vec3.toArray(Vec3.fromArray(arr))).toEqual(arr);
  });

  // ---- property tests ----

  it("property: add is commutative", () => {
    fc.assert(
      fc.property(vec3Arb(), vec3Arb(), (a, b) =>
        Vec3.equals(Vec3.add(a, b), Vec3.add(b, a), 1e-9),
      ),
    );
  });

  it("property: dot is commutative", () => {
    fc.assert(
      fc.property(vec3Arb(), vec3Arb(), (a, b) =>
        Math.abs(Vec3.dot(a, b) - Vec3.dot(b, a)) < 1e-6,
      ),
    );
  });

  it("property: cross of v with itself is zero", () => {
    fc.assert(
      fc.property(vec3Arb(), (v) =>
        Vec3.equals(Vec3.cross(v, v), Vec3.ZERO, 1e-9),
      ),
    );
  });

  it("property: normalize produces unit length (or zero)", () => {
    fc.assert(
      fc.property(nonZeroVec3Arb(), (v) => {
        const n = Vec3.normalize(v);
        return Math.abs(Vec3.length(n) - 1) < 1e-9;
      }),
    );
  });

  it("property: lerp at t=0 is a, at t=1 is b", () => {
    fc.assert(
      fc.property(vec3Arb(), vec3Arb(), (a, b) => {
        return (
          Vec3.equals(Vec3.lerp(a, b, 0), a, 1e-9) &&
          Vec3.equals(Vec3.lerp(a, b, 1), b, 1e-9)
        );
      }),
    );
  });
});
