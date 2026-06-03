/**
 * The simulator's top-level state container (`World`) and one-step
 * orchestrator (`simStep`). Bridges the gap between a controller's
 * `ControlInput` and the integrator's `step(state, forcesWorld, torquesBody,
 * dt)` contract — by aggregating engine and aero contributions, summing
 * gravity and body drag, rotating body-frame thrust/aero into the world
 * frame, integrating, and burning fuel.
 *
 * Why this lives in `packages/physics` and not in the runner:
 * controllers in M4–M6 (PID / MPC / RL) need to forward-roll the same
 * plant for prediction; keeping one canonical orchestrator survives the
 * numpy↔TS port (R1 / SLS-28).
 *
 * Per ADR-004 this module imports only from within `packages/physics`.
 */

import { surfaceForceTorque, updateSurface } from "./aero.js";
import type { Surface, SurfaceState } from "./aero.js";
import { densityAt, pressureRatio } from "./atmosphere.js";
import type { ControlInput, EngineGroup } from "./control.js";
import { bodyDragForce } from "./drag.js";
import { step } from "./integrator.js";
import { consumeFuel, currentCoM, currentInertia, currentMass } from "./mass.js";
import type { MassProperties } from "./mass.js";
import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";
import type { RigidBodyState } from "./state.js";
import { aggregate, initialEngineState } from "./thrust.js";
import type { Engine, EngineCommand, EngineState } from "./thrust.js";

/** Standard surface gravity (m/s²). Distinct from `G0` in thrust.ts which
 * is used solely for the Isp definition. */
const G_EARTH = 9.80665;

/**
 * Full simulation state at one instant. Carries the rigid-body 6-DOF
 * state, the propellant model, per-engine and per-surface actuator
 * states, and the sim clock.
 *
 * `rigidBody.mass` and `rigidBody.inertia` mirror what `mass` says at this
 * instant; `simStep` keeps them in sync.
 */
export type World = {
  readonly rigidBody: RigidBodyState;
  readonly mass: MassProperties;
  readonly engineStates: readonly EngineState[];
  readonly surfaceStates: readonly SurfaceState[];
  /** Sim time elapsed since the scenario started (s). */
  readonly t: number;
};

/**
 * Static vehicle configuration: engines + their grouping, aero surfaces,
 * and body-drag parameters. Constructed once at scenario load; the
 * mutable per-step state lives in `World`.
 */
export type Vehicle = {
  readonly engines: readonly Engine[];
  /** Group each engine belongs to. Parallel to `engines`. */
  readonly engineGroupOf: readonly EngineGroup[];
  readonly surfaces: readonly Surface[];
  /**
   * For each surface, which slot in `ControlInput.fins[]` (kind=grid_fin)
   * or `ControlInput.flaps[]` (kind=flap) drives it. Parallel to
   * `surfaces`. Precomputed once so `simStep` doesn't allocate.
   */
  readonly surfaceCtlIndexOf: readonly number[];
  /** Body-drag reference area (m²). */
  readonly bodyRefArea: number;
  /** Body-drag coefficient (dimensionless, constant for v1; SLS-45 will
   * replace this with `Cd(M)`). */
  readonly bodyCd: number;
};

/** Build a `Vehicle`, computing `surfaceCtlIndexOf` from surface kinds. */
export function defineVehicle(args: {
  engines: readonly Engine[];
  engineGroupOf: readonly EngineGroup[];
  surfaces: readonly Surface[];
  bodyRefArea: number;
  bodyCd: number;
}): Vehicle {
  if (args.engines.length !== args.engineGroupOf.length) {
    throw new Error(
      `defineVehicle: engineGroupOf length (${args.engineGroupOf.length}) ` +
        `must match engines length (${args.engines.length})`,
    );
  }
  let finCursor = 0;
  let flapCursor = 0;
  const surfaceCtlIndexOf = args.surfaces.map((s) =>
    s.kind === "grid_fin" ? finCursor++ : flapCursor++,
  );
  return {
    engines: args.engines,
    engineGroupOf: args.engineGroupOf,
    surfaces: args.surfaces,
    surfaceCtlIndexOf,
    bodyRefArea: args.bodyRefArea,
    bodyCd: args.bodyCd,
  };
}

/** Build a fresh `World` from a vehicle and a rigid-body initial state. */
export function createWorld(args: {
  vehicle: Vehicle;
  mass: MassProperties;
  rigidBody: RigidBodyState;
  t?: number;
}): World {
  return {
    rigidBody: args.rigidBody,
    mass: args.mass,
    engineStates: args.vehicle.engines.map(() => initialEngineState()),
    surfaceStates: args.vehicle.surfaces.map(() => ({ deflection: 0 })),
    t: args.t ?? 0,
  };
}

function targetFor(
  control: ControlInput,
  vehicle: Vehicle,
  i: number,
): { throttleTarget: number; on: boolean } {
  const group = vehicle.engineGroupOf[i]!;
  return {
    throttleTarget: control.engineGroups[group],
    on: control.enginesOn[group],
  };
}

/**
 * Advance the world by `dt` under the given control input.
 *
 * Sequence:
 *  1. Build per-engine commands from the grouped control input.
 *  2. Aggregate the engine plant in body frame → body-frame force/torque,
 *     mass-flow, and updated engine states.
 *  3. Update each aero surface toward its commanded deflection, then sum
 *     surface forces and torques.
 *  4. Rotate body-frame thrust + aero force into the world frame.
 *  5. Add gravity (world) and body drag (world).
 *  6. Integrate the rigid body via `step(...)`.
 *  7. Burn fuel; refresh mass and inertia on the new rigid body.
 *
 * Mass/inertia changes are applied between steps per the mass.ts contract.
 */
export function simStep(
  world: World,
  vehicle: Vehicle,
  control: ControlInput,
  dt: number,
): World {
  // 1. Engine commands.
  const commands: EngineCommand[] = vehicle.engines.map((engine, i) => {
    const tgt = targetFor(control, vehicle, i);
    return {
      gimbalPitchTarget: engine.canGimbal ? control.gimbalPitch : 0,
      gimbalYawTarget: engine.canGimbal ? control.gimbalYaw : 0,
      throttleTarget: tgt.throttleTarget,
      on: tgt.on,
    };
  });

  // 2. Plant aggregation in body frame.
  const altitudeM = world.rigidBody.position.y;
  const pr = pressureRatio(altitudeM);
  const density = densityAt(altitudeM);
  const comBody = currentCoM(world.mass);
  const plant = aggregate(
    vehicle.engines,
    world.engineStates,
    commands,
    comBody,
    pr,
    dt,
  );

  // 3. Aero surfaces.
  const newSurfaceStates: SurfaceState[] = new Array(vehicle.surfaces.length);
  let aeroForceBody = Vec3.ZERO;
  let aeroTorqueBody = Vec3.ZERO;
  for (let i = 0; i < vehicle.surfaces.length; i++) {
    const s = vehicle.surfaces[i]!;
    const st = world.surfaceStates[i]!;
    const idx = vehicle.surfaceCtlIndexOf[i]!;
    const target =
      s.kind === "grid_fin"
        ? (control.fins[idx] ?? 0)
        : (control.flaps[idx] ?? 0);
    const nextSt = updateSurface(s, st, target, dt);
    newSurfaceStates[i] = nextSt;
    const c = surfaceForceTorque(
      s,
      nextSt,
      world.rigidBody.velocity,
      world.rigidBody.angularVelocity,
      world.rigidBody.attitude,
      comBody,
      density,
    );
    aeroForceBody = Vec3.add(aeroForceBody, c.forceBody);
    aeroTorqueBody = Vec3.add(aeroTorqueBody, c.torqueBody);
  }

  // 4. Body→world for thrust + aero.
  const thrustForceWorld = Quat.rotateVec3(
    world.rigidBody.attitude,
    plant.forceBody,
  );
  const aeroForceWorld = Quat.rotateVec3(
    world.rigidBody.attitude,
    aeroForceBody,
  );

  // 5. Gravity (world) + body drag (world).
  const m = world.rigidBody.mass;
  const gravityForceWorld = Vec3.of(0, -m * G_EARTH, 0);
  const dragForceWorld = bodyDragForce(
    world.rigidBody.velocity,
    altitudeM,
    vehicle.bodyRefArea,
    vehicle.bodyCd,
  );

  const forceWorld = Vec3.add(
    Vec3.add(thrustForceWorld, aeroForceWorld),
    Vec3.add(gravityForceWorld, dragForceWorld),
  );
  const torqueBody = Vec3.add(plant.torqueBody, aeroTorqueBody);

  // 6. Integrate.
  const rb1 = step(world.rigidBody, forceWorld, torqueBody, dt);

  // 7. Burn fuel; refresh mass/inertia on the new rigid body.
  const newMass = consumeFuel(world.mass, plant.mdotTotal * dt);
  const rb2: RigidBodyState = {
    position: rb1.position,
    velocity: rb1.velocity,
    attitude: rb1.attitude,
    angularVelocity: rb1.angularVelocity,
    mass: currentMass(newMass),
    inertia: currentInertia(newMass),
  };

  return {
    rigidBody: rb2,
    mass: newMass,
    engineStates: plant.newStates,
    surfaceStates: newSurfaceStates,
    t: world.t + dt,
  };
}
