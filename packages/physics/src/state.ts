/**
 * Rigid-body state — the full 6-DOF dynamical state of a body in the
 * simulation. Per ADR-002 the types are full 6-DOF from day one even when
 * early scenarios constrain certain degrees of freedom to zero.
 */

import { Mat3 } from "./math/mat3.js";
import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";

export type RigidBodyState = {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly attitude: Quat;
  readonly angularVelocity: Vec3;
  readonly mass: number;
  readonly inertia: Mat3;
};

export type RigidBodyInit = {
  readonly mass: number;
  readonly inertia: Mat3;
  readonly position?: Vec3;
  readonly velocity?: Vec3;
  readonly attitude?: Quat;
  readonly angularVelocity?: Vec3;
};

/**
 * Build a `RigidBodyState`, defaulting motion components to rest at the
 * origin with identity attitude. Mass and inertia have no sensible defaults
 * and must be supplied.
 */
export function createRigidBody(init: RigidBodyInit): RigidBodyState {
  return {
    position: init.position ?? Vec3.ZERO,
    velocity: init.velocity ?? Vec3.ZERO,
    attitude: init.attitude ?? Quat.IDENTITY,
    angularVelocity: init.angularVelocity ?? Vec3.ZERO,
    mass: init.mass,
    inertia: init.inertia,
  };
}
