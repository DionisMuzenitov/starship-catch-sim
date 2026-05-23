/**
 * Unit quaternion for 3-D attitude representation.
 *
 * Conventions (chosen up-front, do not change without an ADR):
 * - Component order: `{x, y, z, w}` with `w` as the scalar.
 * - Algebra: Hamilton (`i*j = k`).
 * - Euler angles: intrinsic Z-Y-X (yaw–pitch–roll), aerospace standard.
 * - Vector rotation assumes a unit quaternion. Callers should `normalize`
 *   first if drift is possible.
 *
 * Purity convention: all functions are pure — they accept inputs and return
 * new immutable `Quat` values. Inputs are never mutated.
 */

import { Mat3 } from "./mat3.js";
import { Vec3 } from "./vec3.js";

export type Quat = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
};

const IDENTITY: Quat = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

function of(x: number, y: number, z: number, w: number): Quat {
  return { x, y, z, w };
}

function lengthSquared(q: Quat): number {
  return q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
}

function length(q: Quat): number {
  return Math.sqrt(lengthSquared(q));
}

function normalize(q: Quat, eps = 1e-12): Quat {
  const len2 = lengthSquared(q);
  if (len2 < eps * eps) return IDENTITY;
  const inv = 1 / Math.sqrt(len2);
  return { x: q.x * inv, y: q.y * inv, z: q.z * inv, w: q.w * inv };
}

function conjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/**
 * General inverse. For unit quaternions this is equal to `conjugate`; this
 * implementation also handles non-unit quaternions by dividing by the squared
 * norm.
 */
function inverse(q: Quat): Quat {
  const n2 = lengthSquared(q);
  if (n2 === 0) return IDENTITY;
  const inv = 1 / n2;
  return { x: -q.x * inv, y: -q.y * inv, z: -q.z * inv, w: q.w * inv };
}

/**
 * Hamilton product `a * b`. Quaternion multiplication is not commutative.
 */
function multiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/**
 * Build a quaternion that represents a rotation by `angleRad` radians around
 * `axis`. Caller must pass a unit `axis`; the function does not normalise it.
 */
function fromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const half = angleRad * 0.5;
  const s = Math.sin(half);
  return {
    x: axis.x * s,
    y: axis.y * s,
    z: axis.z * s,
    w: Math.cos(half),
  };
}

/**
 * Build a quaternion from intrinsic Z-Y-X Tait-Bryan angles (yaw, pitch,
 * roll). The composed rotation is `q = qZ(yaw) * qY(pitch) * qX(roll)`.
 */
function fromEulerZYX(yaw: number, pitch: number, roll: number): Quat {
  const cy = Math.cos(yaw * 0.5);
  const sy = Math.sin(yaw * 0.5);
  const cp = Math.cos(pitch * 0.5);
  const sp = Math.sin(pitch * 0.5);
  const cr = Math.cos(roll * 0.5);
  const sr = Math.sin(roll * 0.5);

  return {
    w: cy * cp * cr + sy * sp * sr,
    x: cy * cp * sr - sy * sp * cr,
    y: sy * cp * sr + cy * sp * cr,
    z: sy * cp * cr - cy * sp * sr,
  };
}

/**
 * Convert to a 3x3 rotation matrix (row-major). Assumes unit quaternion.
 */
function toMat3(q: Quat): Mat3 {
  const { x, y, z, w } = q;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;

  return [
    1 - 2 * (yy + zz),
    2 * (xy - wz),
    2 * (xz + wy),

    2 * (xy + wz),
    1 - 2 * (xx + zz),
    2 * (yz - wx),

    2 * (xz - wy),
    2 * (yz + wx),
    1 - 2 * (xx + yy),
  ];
}

/**
 * Rotate a vector by the rotation represented by this (unit) quaternion.
 * Uses the standard optimised form, equivalent to `q * v * q⁻¹` but avoiding
 * the intermediate quaternion constructions.
 */
function rotateVec3(q: Quat, v: Vec3): Vec3 {
  const qv: Vec3 = { x: q.x, y: q.y, z: q.z };
  const t = Vec3.scale(Vec3.cross(qv, v), 2);
  return Vec3.add(Vec3.add(v, Vec3.scale(t, q.w)), Vec3.cross(qv, t));
}

/**
 * Spherical linear interpolation between two unit quaternions. Picks the
 * shortest arc by negating `b` if the dot product is negative.
 */
function slerp(a: Quat, b: Quat, t: number): Quat {
  let cosTheta = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;

  if (cosTheta < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    cosTheta = -cosTheta;
  }

  // Near-parallel: fall back to linear interpolation + normalisation.
  if (cosTheta > 0.9995) {
    return normalize({
      x: a.x + (bx - a.x) * t,
      y: a.y + (by - a.y) * t,
      z: a.z + (bz - a.z) * t,
      w: a.w + (bw - a.w) * t,
    });
  }

  const theta = Math.acos(cosTheta);
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;

  return {
    x: a.x * wa + bx * wb,
    y: a.y * wa + by * wb,
    z: a.z * wa + bz * wb,
    w: a.w * wa + bw * wb,
  };
}

/**
 * Convert a unit quaternion to an axis-angle pair. Returns the X axis with
 * angle 0 when the quaternion represents the identity rotation.
 */
function toAxisAngle(q: Quat): { axis: Vec3; angle: number } {
  const w = Math.max(-1, Math.min(1, q.w));
  const angle = 2 * Math.acos(w);
  const s = Math.sqrt(1 - w * w);
  if (s < 1e-12) {
    return { axis: Vec3.of(1, 0, 0), angle: 0 };
  }
  return { axis: Vec3.of(q.x / s, q.y / s, q.z / s), angle };
}

/**
 * Component-wise equality. Note: as *rotations*, `q` and `-q` are equivalent;
 * this function checks raw component equality and returns false in that case.
 * Use `equalsRotation` for rotation-equivalent comparison.
 */
function equals(a: Quat, b: Quat, eps = 1e-9): boolean {
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.z - b.z) <= eps &&
    Math.abs(a.w - b.w) <= eps
  );
}

function negate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
}

/**
 * Rotation-equivalent equality: treats `q` and `-q` as equal because they
 * describe the same rotation.
 */
function equalsRotation(a: Quat, b: Quat, eps = 1e-9): boolean {
  return equals(a, b, eps) || equals(a, negate(b), eps);
}

export const Quat = {
  IDENTITY,
  of,
  length,
  lengthSquared,
  normalize,
  conjugate,
  inverse,
  multiply,
  fromAxisAngle,
  fromEulerZYX,
  toMat3,
  rotateVec3,
  slerp,
  toAxisAngle,
  equals,
  equalsRotation,
  negate,
} as const;
