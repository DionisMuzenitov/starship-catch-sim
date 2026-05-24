/**
 * Shared single-step driver used by the integration tests. Combines all the
 * physics subsystems into one tick so each test can focus on the scenario
 * rather than re-deriving the force accumulator.
 *
 * Per-step contract (the same one a controller would target):
 *
 *   1. Update engine actuator states given commands and `dt`.
 *   2. Aggregate engine force + torque (body frame) + mass flow.
 *   3. Update aero-surface deflections given target commands.
 *   4. Sum aero-surface forces + torques (body frame).
 *   5. Compute drag in world frame using relative wind.
 *   6. Compute gravity (world frame).
 *   7. Convert body-frame force contributions to world frame via attitude;
 *      sum into total world-frame force.
 *   8. Sum body-frame torques.
 *   9. Step the rigid-body integrator.
 *   10. Burn propellant; recompute mass + inertia for the next step.
 *
 * Note: simulation time `t` is tracked outside this helper so the wind
 * field can be queried with a monotonically non-decreasing argument.
 */

import { aggregate, type Engine, type EngineCommand, type EngineState } from "../../src/thrust.js";
import { bodyDragForce } from "../../src/drag.js";
import { Quat } from "../../src/math/quat.js";
import { Vec3 } from "../../src/math/vec3.js";
import {
  consumeFuel,
  currentCoM,
  currentInertia,
  currentMass,
  type MassProperties,
} from "../../src/mass.js";
import {
  surfaceForceTorque,
  updateSurface,
  type Surface,
  type SurfaceState,
} from "../../src/aero.js";
import { step } from "../../src/integrator.js";
import { densityAt, pressureRatio } from "../../src/atmosphere.js";
import { type RigidBodyState } from "../../src/state.js";
import { type WindField } from "../../src/wind.js";

/** Standard gravity (m/s²). */
export const G = 9.80665;

export type SubsystemState = {
  readonly engineStates: readonly EngineState[];
  readonly surfaceStates: readonly SurfaceState[];
  readonly massProps: MassProperties;
};

export type SubsystemCommands = {
  readonly engineCommands: readonly EngineCommand[];
  readonly surfaceTargets: readonly number[];
};

export type SubsystemConfig = {
  readonly engines: readonly Engine[];
  readonly surfaces: readonly Surface[];
  readonly refArea: number;
  readonly cd: number;
};

export type StepResult = {
  readonly state: RigidBodyState;
  readonly subsystems: SubsystemState;
};

/** One physics tick. Returns next rigid-body + subsystem state. */
export function runStep(
  state: RigidBodyState,
  subsystems: SubsystemState,
  commands: SubsystemCommands,
  config: SubsystemConfig,
  wind: WindField,
  t: number,
  dt: number,
): StepResult {
  const com = currentCoM(subsystems.massProps);
  const altitude = state.position.y;
  const density = densityAt(altitude);
  const pr = pressureRatio(altitude);

  // Engines
  const engineOut = aggregate(
    config.engines,
    subsystems.engineStates,
    commands.engineCommands,
    com,
    pr,
    dt,
  );

  // Aero surfaces
  let surfaceForceBody = Vec3.ZERO;
  let surfaceTorqueBody = Vec3.ZERO;
  const newSurfaceStates: SurfaceState[] = [];
  for (let i = 0; i < config.surfaces.length; i++) {
    const s = config.surfaces[i]!;
    const st = subsystems.surfaceStates[i]!;
    const target = commands.surfaceTargets[i]!;
    const updated = updateSurface(s, st, target, dt);
    newSurfaceStates.push(updated);
    const c = surfaceForceTorque(
      s,
      updated,
      state.velocity,
      state.angularVelocity,
      state.attitude,
      com,
      density,
    );
    surfaceForceBody = Vec3.add(surfaceForceBody, c.forceBody);
    surfaceTorqueBody = Vec3.add(surfaceTorqueBody, c.torqueBody);
  }

  // Drag — world frame, using wind-relative velocity.
  const windVec = wind.at(state.position, t);
  const vRel = Vec3.sub(state.velocity, windVec);
  const dragForceWorld = bodyDragForce(vRel, altitude, config.refArea, config.cd);

  // Gravity — world frame.
  const gravityForceWorld = Vec3.of(0, -state.mass * G, 0);

  // Body-frame contributions → world frame via attitude.
  const bodyForceTotal = Vec3.add(engineOut.forceBody, surfaceForceBody);
  const bodyForceWorld = Quat.rotateVec3(state.attitude, bodyForceTotal);

  const totalForceWorld = Vec3.add(
    Vec3.add(dragForceWorld, gravityForceWorld),
    bodyForceWorld,
  );
  const totalTorqueBody = Vec3.add(engineOut.torqueBody, surfaceTorqueBody);

  // Integrate.
  const newState = step(state, totalForceWorld, totalTorqueBody, dt);

  // Burn propellant for the next tick.
  const newMassProps = consumeFuel(subsystems.massProps, engineOut.mdotTotal * dt);
  const newRigidState: RigidBodyState = {
    ...newState,
    mass: currentMass(newMassProps),
    inertia: currentInertia(newMassProps),
  };

  return {
    state: newRigidState,
    subsystems: {
      engineStates: engineOut.newStates,
      surfaceStates: newSurfaceStates,
      massProps: newMassProps,
    },
  };
}
