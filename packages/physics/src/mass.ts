/**
 * Variable-mass model — propellant burns down, centre of mass shifts, inertia
 * tensor changes. The model is recomputed *between* integrator steps; within
 * a single step `mass` and `inertia` are constant (see ADR-002 and
 * `docs/dynamics.md`).
 *
 * Body frame convention:
 * - Origin at the bottom of the rocket (engine plane).
 * - `+y` points up the rocket (along the long axis).
 * - The propellant tank is a uniform cylinder centred on the `y` axis,
 *   spanning from `tankBottom` to `tankTop` when full.
 * - Propellant is assumed to "settle" at the bottom of the tank — appropriate
 *   for boost / hover regimes; freefall is out of scope for this ticket.
 *
 * Per ADR-004 this module is pure TypeScript and depends only on local math.
 */

import { Mat3 } from "./math/mat3.js";
import { Vec3 } from "./math/vec3.js";

export type MassProperties = {
  readonly dryMass: number; // kg
  readonly propellantMass: number; // kg, mutable across the simulation
  readonly dryCoM: Vec3; // body frame, m — CoM of the empty vehicle
  readonly dryInertia: Mat3; // inertia tensor about dryCoM (kg·m²)
  readonly tankBottom: number; // body-frame y of tank floor (m)
  readonly tankTop: number; // body-frame y of tank ceiling when full (m)
  readonly tankRadius: number; // m
  readonly propellantDensity: number; // kg/m³ (~830 for densified CH4+LOX)
};

const PI = Math.PI;

/** Maximum propellant mass the tank can hold (cylinder volume × density). */
export function tankCapacity(mp: MassProperties): number {
  const length = mp.tankTop - mp.tankBottom;
  return PI * mp.tankRadius * mp.tankRadius * length * mp.propellantDensity;
}

/** Height of the propellant column above tankBottom, given current mass. */
function propellantHeight(mp: MassProperties): number {
  if (mp.propellantMass <= 0) return 0;
  const areaTimesDensity =
    PI * mp.tankRadius * mp.tankRadius * mp.propellantDensity;
  return mp.propellantMass / areaTimesDensity;
}

/** Body-frame CoM of the propellant column (midpoint of the filled segment). */
function propellantCoM(mp: MassProperties): Vec3 {
  const h = propellantHeight(mp);
  return Vec3.of(0, mp.tankBottom + h * 0.5, 0);
}

/** Top up the propellant to tank capacity. */
export function full(mp: MassProperties): MassProperties {
  return { ...mp, propellantMass: tankCapacity(mp) };
}

/** Reduce propellant by `kg`, clamped to zero. */
export function consumeFuel(mp: MassProperties, kg: number): MassProperties {
  const next = Math.max(0, mp.propellantMass - kg);
  return { ...mp, propellantMass: next };
}

/** Total instantaneous mass: dry + propellant. */
export function currentMass(mp: MassProperties): number {
  return mp.dryMass + mp.propellantMass;
}

/**
 * Combined centre of mass in body frame — mass-weighted average of dry CoM
 * and propellant CoM.
 */
export function currentCoM(mp: MassProperties): Vec3 {
  if (mp.propellantMass <= 0) return mp.dryCoM;
  const propCoM = propellantCoM(mp);
  const total = currentMass(mp);
  const wDry = mp.dryMass / total;
  const wProp = mp.propellantMass / total;
  return {
    x: mp.dryCoM.x * wDry + propCoM.x * wProp,
    y: mp.dryCoM.y * wDry + propCoM.y * wProp,
    z: mp.dryCoM.z * wDry + propCoM.z * wProp,
  };
}

/**
 * Parallel-axis correction term: `m * (||d||² · I − d ⊗ d)`. Applied to the
 * inertia of a body whose own-CoM inertia is known, to shift the reference
 * point by displacement `d` (from the body's own CoM to the desired point).
 */
function parallelAxisCorrection(mass: number, d: Vec3): Mat3 {
  const d2 = Vec3.lengthSquared(d);
  const dx = d.x;
  const dy = d.y;
  const dz = d.z;
  return [
    mass * (d2 - dx * dx),
    -mass * dx * dy,
    -mass * dx * dz,
    -mass * dy * dx,
    mass * (d2 - dy * dy),
    -mass * dy * dz,
    -mass * dz * dx,
    -mass * dz * dy,
    mass * (d2 - dz * dz),
  ];
}

function addMat3(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] + b[0],
    a[1] + b[1],
    a[2] + b[2],
    a[3] + b[3],
    a[4] + b[4],
    a[5] + b[5],
    a[6] + b[6],
    a[7] + b[7],
    a[8] + b[8],
  ];
}

/**
 * Inertia tensor of a uniform solid cylinder of mass `m`, radius `r`,
 * height `h`, with its symmetry axis along the body Y axis. Result is
 * about the cylinder's own centre of mass, in body-frame axes.
 *
 *   I_yy = (1/2) m r²
 *   I_xx = I_zz = (1/12) m (3 r² + h²)
 */
function cylinderInertia(mass: number, r: number, h: number): Mat3 {
  const Iy = 0.5 * mass * r * r;
  const Ix = (1 / 12) * mass * (3 * r * r + h * h);
  return Mat3.of(Ix, 0, 0, 0, Iy, 0, 0, 0, Ix);
}

/**
 * Combined inertia tensor about the current (combined) CoM, in body frame.
 *
 * Each component (dry + propellant) contributes:
 *   I_about_combined = I_about_own_CoM + m * paraCorrection(combined − own)
 */
export function currentInertia(mp: MassProperties): Mat3 {
  const combinedCoM = currentCoM(mp);

  // Dry contribution shifted to combined CoM.
  const dryDisp = Vec3.sub(combinedCoM, mp.dryCoM);
  const dryShifted = addMat3(
    mp.dryInertia,
    parallelAxisCorrection(mp.dryMass, dryDisp),
  );

  if (mp.propellantMass <= 0) return dryShifted;

  // Propellant contribution shifted to combined CoM.
  const h = propellantHeight(mp);
  const propCoM = propellantCoM(mp);
  const propOwn = cylinderInertia(mp.propellantMass, mp.tankRadius, h);
  const propDisp = Vec3.sub(combinedCoM, propCoM);
  const propShifted = addMat3(
    propOwn,
    parallelAxisCorrection(mp.propellantMass, propDisp),
  );

  return addMat3(dryShifted, propShifted);
}
