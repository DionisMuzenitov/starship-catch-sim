/**
 * Classical fourth-order Runge–Kutta (RK4) integrator for the full 6-DOF
 * rigid-body equations of motion. See `docs/dynamics.md` for the derivation.
 *
 * Conventions:
 * - Translational state (`position`, `velocity`) lives in the **world frame**.
 * - Angular state (`angularVelocity`, `inertia`) lives in the **body frame**.
 * - `attitude` is the rotation that takes body-frame vectors to world-frame.
 * - SI units throughout: metres, seconds, kilograms, newtons, newton-metres,
 *   radians per second.
 *
 * `mass` and `inertia` are treated as constant within a single `step`. They
 * may change *between* steps (e.g. propellant depletion in SLS-9).
 */

import { Mat3 } from "./math/mat3.js";
import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";
import type { RigidBodyState } from "./state.js";

/**
 * The continuous-time derivative of a `RigidBodyState`. Note `dAttitude` is
 * a general 4-tuple, not a unit quaternion — it represents `dq/dt` which is
 * tangent to the unit-quaternion manifold, not on it.
 */
type StateDerivative = {
  readonly dPosition: Vec3;
  readonly dVelocity: Vec3;
  readonly dAttitude: Quat;
  readonly dAngularVelocity: Vec3;
};

function derivative(
  position: Vec3,
  velocity: Vec3,
  attitude: Quat,
  angularVelocity: Vec3,
  forcesWorld: Vec3,
  torquesBody: Vec3,
  mass: number,
  inertia: Mat3,
  inertiaInv: Mat3,
): StateDerivative {
  // Translation
  // dx/dt = v
  // dv/dt = F / m
  void position; // explicit: dx/dt depends only on v
  const dVelocity = Vec3.scale(forcesWorld, 1 / mass);

  // Attitude kinematics: dq/dt = 0.5 * q ⊗ (ω, 0)  (omega in body frame,
  // embedded as a pure quaternion).
  const omegaPure: Quat = {
    x: angularVelocity.x,
    y: angularVelocity.y,
    z: angularVelocity.z,
    w: 0,
  };
  const qOmega = Quat.multiply(attitude, omegaPure);
  const dAttitude: Quat = {
    x: qOmega.x * 0.5,
    y: qOmega.y * 0.5,
    z: qOmega.z * 0.5,
    w: qOmega.w * 0.5,
  };

  // Euler's equation (body frame):
  // dω/dt = I⁻¹ ( τ − ω × (I ω) )
  const Iomega = Mat3.multiplyVec3(inertia, angularVelocity);
  const gyro = Vec3.cross(angularVelocity, Iomega);
  const dAngularVelocity = Mat3.multiplyVec3(
    inertiaInv,
    Vec3.sub(torquesBody, gyro),
  );

  return {
    dPosition: velocity,
    dVelocity,
    dAttitude,
    dAngularVelocity,
  };
}

function addScaledVec3(a: Vec3, b: Vec3, s: number): Vec3 {
  return { x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s };
}

function addScaledQuat(a: Quat, b: Quat, s: number): Quat {
  return {
    x: a.x + b.x * s,
    y: a.y + b.y * s,
    z: a.z + b.z * s,
    w: a.w + b.w * s,
  };
}

/**
 * Advance the rigid-body state by one timestep using classical 4-stage RK4.
 * The quaternion is renormalised at the end of the step to absorb numerical
 * drift away from the unit-norm manifold.
 *
 * @param state            current rigid-body state
 * @param forcesWorld      total external force on the body in **world frame**
 *                         (newtons). The caller is responsible for summing
 *                         gravity, drag, thrust, etc.
 * @param torquesBody      total external torque on the body in **body frame**
 *                         (newton-metres).
 * @param dt               timestep (seconds). Should be small enough that
 *                         dynamics within the step are well-approximated by
 *                         a smooth ODE; 1–10 ms is typical for spacecraft.
 */
export function step(
  state: RigidBodyState,
  forcesWorld: Vec3,
  torquesBody: Vec3,
  dt: number,
): RigidBodyState {
  // Inertia is constant within the step — invert once and reuse across all
  // four RK4 stages.
  const inertiaInv = Mat3.inverse(state.inertia);
  const { mass, inertia } = state;

  const evalAt = (
    position: Vec3,
    velocity: Vec3,
    attitude: Quat,
    angularVelocity: Vec3,
  ) =>
    derivative(
      position,
      velocity,
      attitude,
      angularVelocity,
      forcesWorld,
      torquesBody,
      mass,
      inertia,
      inertiaInv,
    );

  const k1 = evalAt(
    state.position,
    state.velocity,
    state.attitude,
    state.angularVelocity,
  );

  const halfDt = dt * 0.5;
  const k2 = evalAt(
    addScaledVec3(state.position, k1.dPosition, halfDt),
    addScaledVec3(state.velocity, k1.dVelocity, halfDt),
    addScaledQuat(state.attitude, k1.dAttitude, halfDt),
    addScaledVec3(state.angularVelocity, k1.dAngularVelocity, halfDt),
  );

  const k3 = evalAt(
    addScaledVec3(state.position, k2.dPosition, halfDt),
    addScaledVec3(state.velocity, k2.dVelocity, halfDt),
    addScaledQuat(state.attitude, k2.dAttitude, halfDt),
    addScaledVec3(state.angularVelocity, k2.dAngularVelocity, halfDt),
  );

  const k4 = evalAt(
    addScaledVec3(state.position, k3.dPosition, dt),
    addScaledVec3(state.velocity, k3.dVelocity, dt),
    addScaledQuat(state.attitude, k3.dAttitude, dt),
    addScaledVec3(state.angularVelocity, k3.dAngularVelocity, dt),
  );

  // Weighted sum: y_{n+1} = y_n + (dt/6) * (k1 + 2 k2 + 2 k3 + k4)
  const sixth = dt / 6;
  const sumVec = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): Vec3 => ({
    x: (a.x + 2 * b.x + 2 * c.x + d.x) * sixth,
    y: (a.y + 2 * b.y + 2 * c.y + d.y) * sixth,
    z: (a.z + 2 * b.z + 2 * c.z + d.z) * sixth,
  });
  const sumQuat = (a: Quat, b: Quat, c: Quat, d: Quat): Quat => ({
    x: (a.x + 2 * b.x + 2 * c.x + d.x) * sixth,
    y: (a.y + 2 * b.y + 2 * c.y + d.y) * sixth,
    z: (a.z + 2 * b.z + 2 * c.z + d.z) * sixth,
    w: (a.w + 2 * b.w + 2 * c.w + d.w) * sixth,
  });

  const dPosition = sumVec(
    k1.dPosition,
    k2.dPosition,
    k3.dPosition,
    k4.dPosition,
  );
  const dVelocity = sumVec(
    k1.dVelocity,
    k2.dVelocity,
    k3.dVelocity,
    k4.dVelocity,
  );
  const dAttitude = sumQuat(
    k1.dAttitude,
    k2.dAttitude,
    k3.dAttitude,
    k4.dAttitude,
  );
  const dAngularVelocity = sumVec(
    k1.dAngularVelocity,
    k2.dAngularVelocity,
    k3.dAngularVelocity,
    k4.dAngularVelocity,
  );

  // Renormalise attitude to absorb floating-point drift off the unit-norm
  // manifold. Without this, error accumulates and rotations become shears.
  const newAttitude = Quat.normalize({
    x: state.attitude.x + dAttitude.x,
    y: state.attitude.y + dAttitude.y,
    z: state.attitude.z + dAttitude.z,
    w: state.attitude.w + dAttitude.w,
  });

  return {
    position: addScaledVec3(state.position, dPosition, 1),
    velocity: addScaledVec3(state.velocity, dVelocity, 1),
    attitude: newAttitude,
    angularVelocity: addScaledVec3(state.angularVelocity, dAngularVelocity, 1),
    mass,
    inertia,
  };
}
