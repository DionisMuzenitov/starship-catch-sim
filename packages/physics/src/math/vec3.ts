/**
 * 3-D vector in a right-handed coordinate system.
 *
 * Convention: all functions are pure — they accept inputs and return new
 * immutable `Vec3` values. Inputs are never mutated. Treat `Vec3` as a value,
 * not an entity; pass it around freely without worrying about aliasing.
 *
 * Engine-agnostic per ADR-004: no Three.js, no React, no external deps.
 */

export type Vec3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });

function of(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function negate(v: Vec3): Vec3 {
  return { x: -v.x, y: -v.y, z: -v.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function lengthSquared(v: Vec3): number {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

function length(v: Vec3): number {
  return Math.sqrt(lengthSquared(v));
}

/**
 * Returns a unit vector pointing in the same direction as `v`. If `v` has
 * length below `eps`, returns `ZERO` (rather than producing NaN). This matches
 * the convention used by gl-matrix and three.js.
 */
function normalize(v: Vec3, eps = 1e-12): Vec3 {
  const len2 = lengthSquared(v);
  if (len2 < eps * eps) return ZERO;
  const inv = 1 / Math.sqrt(len2);
  return { x: v.x * inv, y: v.y * inv, z: v.z * inv };
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function equals(a: Vec3, b: Vec3, eps = 1e-9): boolean {
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.z - b.z) <= eps
  );
}

function fromArray(arr: readonly [number, number, number]): Vec3 {
  return { x: arr[0], y: arr[1], z: arr[2] };
}

function toArray(v: Vec3): [number, number, number] {
  return [v.x, v.y, v.z];
}

export const Vec3 = {
  ZERO,
  of,
  add,
  sub,
  scale,
  negate,
  dot,
  cross,
  length,
  lengthSquared,
  normalize,
  lerp,
  equals,
  fromArray,
  toArray,
} as const;
