/**
 * 3x3 matrix stored as a flat tuple in **row-major** order:
 *
 *   [m00, m01, m02,
 *    m10, m11, m12,
 *    m20, m21, m22]
 *
 * Used by the physics core for rotation matrices (from quaternion) and
 * inertia tensors. Same purity convention as Vec3: immutable, pure functions.
 */

import { Vec3 } from "./vec3.js";

export type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

const IDENTITY: Mat3 = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1] as const);

function of(
  m00: number,
  m01: number,
  m02: number,
  m10: number,
  m11: number,
  m12: number,
  m20: number,
  m21: number,
  m22: number,
): Mat3 {
  return [m00, m01, m02, m10, m11, m12, m20, m21, m22];
}

/**
 * Build a diagonal matrix from a Vec3. Useful for principal-axis inertia
 * tensors where the diagonal is `[Ixx, Iyy, Izz]`.
 */
function fromDiagonal(d: Vec3): Mat3 {
  return [d.x, 0, 0, 0, d.y, 0, 0, 0, d.z];
}

function multiplyVec3(m: Mat3, v: Vec3): Vec3 {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
  };
}

function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

function determinant(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/**
 * Closed-form inverse via the adjugate formula. Throws if the matrix is
 * singular (|det| < eps). For diagonal inertia tensors this is cheap; we
 * accept the cost for generality.
 */
function inverse(m: Mat3, eps = 1e-12): Mat3 {
  const det = determinant(m);
  if (Math.abs(det) < eps) {
    throw new Error("Mat3.inverse: matrix is singular");
  }
  const invDet = 1 / det;
  return [
    (m[4] * m[8] - m[5] * m[7]) * invDet,
    (m[2] * m[7] - m[1] * m[8]) * invDet,
    (m[1] * m[5] - m[2] * m[4]) * invDet,
    (m[5] * m[6] - m[3] * m[8]) * invDet,
    (m[0] * m[8] - m[2] * m[6]) * invDet,
    (m[2] * m[3] - m[0] * m[5]) * invDet,
    (m[3] * m[7] - m[4] * m[6]) * invDet,
    (m[1] * m[6] - m[0] * m[7]) * invDet,
    (m[0] * m[4] - m[1] * m[3]) * invDet,
  ];
}

function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

function equals(a: Mat3, b: Mat3, eps = 1e-9): boolean {
  for (let i = 0; i < 9; i++) {
    if (Math.abs(a[i]! - b[i]!) > eps) return false;
  }
  return true;
}

export const Mat3 = {
  IDENTITY,
  of,
  fromDiagonal,
  multiplyVec3,
  multiplyMat3,
  transpose,
  determinant,
  inverse,
  equals,
} as const;
