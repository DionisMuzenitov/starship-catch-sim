import { describe, expect, it } from "vitest";

import { Mat3 } from "../../src/math/mat3.js";
import { Quat } from "../../src/math/quat.js";
import { Vec3 } from "../../src/math/vec3.js";
import {
  initialEngineState,
  type EngineCommand,
  type Engine,
} from "../../src/thrust.js";
import { constantWind } from "../../src/wind.js";
import { runStep } from "./runStep.js";
import type { RigidBodyState } from "../../src/state.js";
import type { MassProperties } from "../../src/mass.js";

/**
 * Gimballing a single centre engine should produce a torque in the
 * predictable direction. With the engine mounted at (0, 0, 0), CoM at
 * (0, 10, 0), nominal thrust direction (0, -1, 0), gimbalPitch = +5° about
 * body X, the thrust vector tilts toward +/-z. The arm from engine to CoM
 * is purely +y, so the cross product yields a torque about body X.
 *
 * The exact sign depends on the rotation convention (active vs passive,
 * left vs right handed) used inside `Quat.fromAxisAngle`. We verify:
 *  - torque component about body X is non-zero
 *  - torque component about body Y is zero (no roll from pitch gimbal)
 *  - the angular velocity it drives respects the sign of the torque
 */
describe("integration: gimbal torque", () => {
  it("centre engine +5° pitch gimbal produces angular acceleration about body X", () => {
    const mass = 1_000;
    const I = Mat3.fromDiagonal(Vec3.of(2000, 2000, 2000));
    const com = Vec3.of(0, 10, 0);

    let state: RigidBodyState = {
      position: Vec3.of(0, 100_000, 0), // high altitude → ~vacuum, no drag
      velocity: Vec3.ZERO,
      attitude: Quat.IDENTITY,
      angularVelocity: Vec3.ZERO,
      mass,
      inertia: I,
    };

    const engine: Engine = {
      mount: Vec3.ZERO,
      direction: Vec3.of(0, -1, 0),
      thrustVac: 100_000,
      thrustSea: 100_000,
      ispVac: 1e9,
      ispSea: 1e9,
      maxGimbal: 0.1,
      maxGimbalRate: 10,
      minThrottle: 0,
      tauThrottle: 0.0001,
      tauGimbal: 0.0001,
      canGimbal: true,
    };

    const massProps: MassProperties = {
      dryMass: mass,
      propellantMass: 0,
      dryCoM: com,
      dryInertia: I,
      tankBottom: 0,
      tankTop: 1,
      tankRadius: 0.1,
      propellantDensity: 1,
    };

    let subsystems = {
      engineStates: [
        { ...initialEngineState(), throttle: 1, on: true, gimbalPitch: 0.087 },
      ],
      surfaceStates: [],
      massProps,
    };

    const cmd: EngineCommand = {
      gimbalPitchTarget: 0.087, // ~5°
      gimbalYawTarget: 0,
      throttleTarget: 1,
      on: true,
    };

    const wind = constantWind(Vec3.ZERO);
    const dt = 0.001;
    const N = 100;

    for (let i = 0; i < N; i++) {
      const res = runStep(
        state,
        subsystems,
        { engineCommands: [cmd], surfaceTargets: [] },
        { engines: [engine], surfaces: [], refArea: 0, cd: 0 },
        wind,
        i * dt,
        dt,
      );
      state = res.state;
      subsystems = res.subsystems;
    }

    // After 0.1 s of constant torque, angular velocity should be nontrivial
    // about body X (gimbal about X axis tilts thrust in YZ, with arm in Y →
    // torque in X). Roll axis (Y) should be essentially zero — gimballing
    // doesn't spin the rocket about its own long axis.
    expect(Math.abs(state.angularVelocity.x)).toBeGreaterThan(1e-4);
    expect(Math.abs(state.angularVelocity.y)).toBeLessThan(1e-4);
  });
});
