import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { Mat3 } from "./mat3.js";
import { Quat } from "./quat.js";
import { Vec3 } from "./vec3.js";

const finiteNumber = (range = 1e3) =>
  fc.double({
    min: -range,
    max: range,
    noNaN: true,
    noDefaultInfinity: true,
  });

const quatArb = () =>
  fc
    .record({
      x: finiteNumber(),
      y: finiteNumber(),
      z: finiteNumber(),
      w: finiteNumber(),
    })
    .filter((q) => Quat.lengthSquared(q) > 1e-6);

const unitQuatArb = () => quatArb().map((q) => Quat.normalize(q));

const vec3Arb = () =>
  fc.record({
    x: finiteNumber(),
    y: finiteNumber(),
    z: finiteNumber(),
  });

const angleArb = () =>
  fc.double({
    min: -Math.PI,
    max: Math.PI,
    noNaN: true,
    noDefaultInfinity: true,
  });

const unitAxisArb = () =>
  fc
    .record({ x: finiteNumber(), y: finiteNumber(), z: finiteNumber() })
    .filter((v) => Vec3.lengthSquared(v) > 1e-3)
    .map((v) => Vec3.normalize(v));

describe("Quat", () => {
  // ---- constants and constructors ----

  it("IDENTITY is (0,0,0,1)", () => {
    expect(Quat.IDENTITY).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it("of builds a quaternion", () => {
    expect(Quat.of(1, 2, 3, 4)).toEqual({ x: 1, y: 2, z: 3, w: 4 });
  });

  // ---- basic ops ----

  it("length and lengthSquared", () => {
    const q = Quat.of(1, 2, 2, 0);
    expect(Quat.lengthSquared(q)).toBe(9);
    expect(Quat.length(q)).toBe(3);
  });

  it("normalize of zero returns IDENTITY", () => {
    expect(Quat.normalize(Quat.of(0, 0, 0, 0))).toEqual(Quat.IDENTITY);
  });

  it("conjugate negates the vector part", () => {
    expect(Quat.conjugate(Quat.of(1, 2, 3, 4))).toEqual(Quat.of(-1, -2, -3, 4));
  });

  it("inverse of IDENTITY is IDENTITY", () => {
    expect(Quat.equals(Quat.inverse(Quat.IDENTITY), Quat.IDENTITY)).toBe(true);
  });

  it("inverse of zero quaternion returns IDENTITY", () => {
    expect(Quat.inverse(Quat.of(0, 0, 0, 0))).toEqual(Quat.IDENTITY);
  });

  it("negate flips every component", () => {
    expect(Quat.negate(Quat.of(1, 2, 3, 4))).toEqual(Quat.of(-1, -2, -3, -4));
  });

  it("multiply by IDENTITY is the original", () => {
    const q = Quat.fromAxisAngle(Vec3.of(0, 0, 1), Math.PI / 3);
    expect(Quat.equals(Quat.multiply(q, Quat.IDENTITY), q)).toBe(true);
    expect(Quat.equals(Quat.multiply(Quat.IDENTITY, q), q)).toBe(true);
  });

  it("multiply implements Hamilton i*j = k", () => {
    // i = (1,0,0,0), j = (0,1,0,0), k = (0,0,1,0)
    const i = Quat.of(1, 0, 0, 0);
    const j = Quat.of(0, 1, 0, 0);
    const k = Quat.of(0, 0, 1, 0);
    expect(Quat.equals(Quat.multiply(i, j), k)).toBe(true);
    expect(Quat.equals(Quat.multiply(j, k), i)).toBe(true);
    expect(Quat.equals(Quat.multiply(k, i), j)).toBe(true);
  });

  // ---- fromAxisAngle ----

  it("fromAxisAngle(Z, 0) is IDENTITY", () => {
    const q = Quat.fromAxisAngle(Vec3.of(0, 0, 1), 0);
    expect(Quat.equals(q, Quat.IDENTITY)).toBe(true);
  });

  it("fromAxisAngle(Z, 90°) rotates X→Y", () => {
    const q = Quat.fromAxisAngle(Vec3.of(0, 0, 1), Math.PI / 2);
    const rotated = Quat.rotateVec3(q, Vec3.of(1, 0, 0));
    expect(Vec3.equals(rotated, Vec3.of(0, 1, 0), 1e-9)).toBe(true);
  });

  it("fromAxisAngle(Y, 90°) rotates X→-Z", () => {
    const q = Quat.fromAxisAngle(Vec3.of(0, 1, 0), Math.PI / 2);
    const rotated = Quat.rotateVec3(q, Vec3.of(1, 0, 0));
    expect(Vec3.equals(rotated, Vec3.of(0, 0, -1), 1e-9)).toBe(true);
  });

  it("fromAxisAngle(X, 90°) rotates Y→Z", () => {
    const q = Quat.fromAxisAngle(Vec3.of(1, 0, 0), Math.PI / 2);
    const rotated = Quat.rotateVec3(q, Vec3.of(0, 1, 0));
    expect(Vec3.equals(rotated, Vec3.of(0, 0, 1), 1e-9)).toBe(true);
  });

  // ---- fromEulerZYX ----

  it("fromEulerZYX(0,0,0) is IDENTITY", () => {
    expect(Quat.equals(Quat.fromEulerZYX(0, 0, 0), Quat.IDENTITY)).toBe(true);
  });

  it("fromEulerZYX(yaw,0,0) rotates around Z", () => {
    const q = Quat.fromEulerZYX(Math.PI / 2, 0, 0);
    const rotated = Quat.rotateVec3(q, Vec3.of(1, 0, 0));
    expect(Vec3.equals(rotated, Vec3.of(0, 1, 0), 1e-9)).toBe(true);
  });

  it("fromEulerZYX(0,pitch,0) rotates around Y", () => {
    const q = Quat.fromEulerZYX(0, Math.PI / 2, 0);
    const rotated = Quat.rotateVec3(q, Vec3.of(1, 0, 0));
    expect(Vec3.equals(rotated, Vec3.of(0, 0, -1), 1e-9)).toBe(true);
  });

  it("fromEulerZYX(0,0,roll) rotates around X", () => {
    const q = Quat.fromEulerZYX(0, 0, Math.PI / 2);
    const rotated = Quat.rotateVec3(q, Vec3.of(0, 1, 0));
    expect(Vec3.equals(rotated, Vec3.of(0, 0, 1), 1e-9)).toBe(true);
  });

  // ---- toMat3 ----

  it("toMat3 of IDENTITY is identity matrix", () => {
    expect(Mat3.equals(Quat.toMat3(Quat.IDENTITY), Mat3.IDENTITY)).toBe(true);
  });

  it("toMat3 result rotates vectors consistently with rotateVec3", () => {
    const q = Quat.fromAxisAngle(Vec3.of(0, 0, 1), Math.PI / 4);
    const v = Vec3.of(1, 0, 0);
    const viaMat = Mat3.multiplyVec3(Quat.toMat3(q), v);
    const viaRot = Quat.rotateVec3(q, v);
    expect(Vec3.equals(viaMat, viaRot, 1e-9)).toBe(true);
  });

  // ---- slerp ----

  it("slerp at t=0 returns a", () => {
    const a = Quat.fromAxisAngle(Vec3.of(0, 0, 1), 0.5);
    const b = Quat.fromAxisAngle(Vec3.of(0, 0, 1), 2.0);
    expect(Quat.equalsRotation(Quat.slerp(a, b, 0), a, 1e-9)).toBe(true);
  });

  it("slerp at t=1 returns b (up to sign)", () => {
    const a = Quat.fromAxisAngle(Vec3.of(0, 0, 1), 0.5);
    const b = Quat.fromAxisAngle(Vec3.of(0, 0, 1), 2.0);
    expect(Quat.equalsRotation(Quat.slerp(a, b, 1), b, 1e-9)).toBe(true);
  });

  it("slerp near-parallel falls back to lerp+normalise", () => {
    // Two nearly-identical quaternions trigger the cosTheta > 0.9995 branch.
    const a = Quat.fromAxisAngle(Vec3.of(0, 0, 1), 0.1);
    const b = Quat.fromAxisAngle(Vec3.of(0, 0, 1), 0.10001);
    const mid = Quat.slerp(a, b, 0.5);
    expect(Math.abs(Quat.length(mid) - 1)).toBeLessThan(1e-9);
  });

  it("slerp takes the shortest arc when dot(a,b) < 0", () => {
    // q and -q are the same rotation; slerp should not go the long way.
    const a = Quat.IDENTITY;
    const b = Quat.negate(Quat.IDENTITY);
    const mid = Quat.slerp(a, b, 0.5);
    expect(Quat.equalsRotation(mid, Quat.IDENTITY, 1e-9)).toBe(true);
  });

  // ---- toAxisAngle ----

  it("toAxisAngle of IDENTITY has angle 0", () => {
    const { angle } = Quat.toAxisAngle(Quat.IDENTITY);
    expect(angle).toBe(0);
  });

  it("toAxisAngle round-trip with fromAxisAngle", () => {
    const axis = Vec3.normalize(Vec3.of(1, 2, 3));
    const angle = Math.PI / 3;
    const q = Quat.fromAxisAngle(axis, angle);
    const { axis: a2, angle: ang2 } = Quat.toAxisAngle(q);
    expect(Math.abs(ang2 - angle)).toBeLessThan(1e-9);
    expect(Vec3.equals(a2, axis, 1e-9)).toBe(true);
  });

  // ---- equals / equalsRotation ----

  it("equals does not treat q and -q as equal", () => {
    const q = Quat.fromAxisAngle(Vec3.of(0, 0, 1), 0.5);
    expect(Quat.equals(q, Quat.negate(q))).toBe(false);
  });

  it("equalsRotation treats q and -q as equal", () => {
    const q = Quat.fromAxisAngle(Vec3.of(0, 0, 1), 0.5);
    expect(Quat.equalsRotation(q, Quat.negate(q), 1e-9)).toBe(true);
  });

  // ---- property tests required by SLS-7 AC ----

  it("property: normalize always produces a unit quaternion", () => {
    fc.assert(
      fc.property(quatArb(), (q) => {
        const n = Quat.normalize(q);
        return Math.abs(Quat.length(n) - 1) < 1e-9;
      }),
    );
  });

  it("property: q * q⁻¹ ≈ IDENTITY", () => {
    fc.assert(
      fc.property(unitQuatArb(), (q) => {
        const result = Quat.multiply(q, Quat.inverse(q));
        return Quat.equals(result, Quat.IDENTITY, 1e-9);
      }),
    );
  });

  it("property: rotation preserves vector length", () => {
    fc.assert(
      fc.property(unitQuatArb(), vec3Arb(), (q, v) => {
        const rotated = Quat.rotateVec3(q, v);
        return Math.abs(Vec3.length(rotated) - Vec3.length(v)) < 1e-6;
      }),
    );
  });

  it("property: slerp endpoints ≈ inputs (rotation-equivalent)", () => {
    fc.assert(
      fc.property(unitQuatArb(), unitQuatArb(), (a, b) => {
        return (
          Quat.equalsRotation(Quat.slerp(a, b, 0), a, 1e-9) &&
          Quat.equalsRotation(Quat.slerp(a, b, 1), b, 1e-9)
        );
      }),
    );
  });

  // ---- extra invariants ----

  it("property: conjugate of conjugate is original", () => {
    fc.assert(
      fc.property(quatArb(), (q) => {
        return Quat.equals(Quat.conjugate(Quat.conjugate(q)), q, 1e-9);
      }),
    );
  });

  it("property: rotation by axis-angle and reverse cancels out", () => {
    fc.assert(
      fc.property(unitAxisArb(), angleArb(), vec3Arb(), (axis, angle, v) => {
        const q = Quat.fromAxisAngle(axis, angle);
        const qInv = Quat.fromAxisAngle(axis, -angle);
        const round = Quat.rotateVec3(qInv, Quat.rotateVec3(q, v));
        return Vec3.equals(round, v, 1e-6);
      }),
    );
  });
});
