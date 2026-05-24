import { describe, expect, it } from "vitest";

import { Mat3 } from "../../src/math/mat3.js";
import { Quat } from "../../src/math/quat.js";
import { Vec3 } from "../../src/math/vec3.js";
import {
  initialEngineState,
  type EngineCommand,
} from "../../src/thrust.js";
import { initialSurfaceState } from "../../src/aero.js";
import { constantWind } from "../../src/wind.js";
import { runStep, G } from "./runStep.js";
import type { RigidBodyState } from "../../src/state.js";
import type { MassProperties } from "../../src/mass.js";
import type { Engine } from "../../src/thrust.js";

/**
 * Pure hover: a single dummy "engine" that produces exactly `m·g` of upward
 * world-frame thrust regardless of attitude (we keep attitude at identity so
 * body-up == world-up). Mass is held constant — no fuel burn — so the
 * thrust = weight balance is exact for the duration.
 *
 * The intent is to exercise the *integrator + force-summation plumbing*,
 * not the engine plant. Using the real Raptor plant + variable mass would
 * make perfect hover impossible without a controller.
 */
describe("integration: hover", () => {
  it("perfect-thrust hover holds position to <1 m over 30 s", () => {
    // Tiny dummy body: 1 kg, unit inertia, at (0, 1000, 0), rest.
    const mass = 1;
    const inertia = Mat3.fromDiagonal(Vec3.of(1, 1, 1));
    const startPos = Vec3.of(0, 1000, 0);

    let state: RigidBodyState = {
      position: startPos,
      velocity: Vec3.ZERO,
      attitude: Quat.IDENTITY,
      angularVelocity: Vec3.ZERO,
      mass,
      inertia,
    };

    // A single engine mounted at the CoM pointing up. By placing it AT the
    // CoM we eliminate gimbal-arm torque entirely.
    const upEngine: Engine = {
      mount: Vec3.ZERO, // = CoM (which is dryCoM since no propellant)
      direction: Vec3.of(0, 1, 0), // +y in body frame
      thrustVac: mass * G, // perfect lift
      thrustSea: mass * G,
      ispVac: 1e9, // effectively no fuel burn
      ispSea: 1e9,
      maxGimbal: 0,
      maxGimbalRate: 0,
      minThrottle: 0,
      tauThrottle: 0.0001, // ramps up instantly
      tauGimbal: 0,
      canGimbal: false,
    };

    const massProps: MassProperties = {
      dryMass: mass,
      propellantMass: 0,
      dryCoM: Vec3.ZERO,
      dryInertia: inertia,
      tankBottom: 0,
      tankTop: 1,
      tankRadius: 0.1,
      propellantDensity: 1,
    };

    let subsystems = {
      engineStates: [{ ...initialEngineState(), throttle: 1, on: true }],
      surfaceStates: [] as ReturnType<typeof initialSurfaceState>[],
      massProps,
    };

    const cmd: EngineCommand = {
      gimbalPitchTarget: 0,
      gimbalYawTarget: 0,
      throttleTarget: 1,
      on: true,
    };

    const wind = constantWind(Vec3.ZERO);
    const dt = 0.01;
    const T = 30; // s
    const N = Math.round(T / dt);

    for (let i = 0; i < N; i++) {
      const res = runStep(
        state,
        subsystems,
        { engineCommands: [cmd], surfaceTargets: [] },
        { engines: [upEngine], surfaces: [], refArea: 0, cd: 0 },
        wind,
        i * dt,
        dt,
      );
      state = res.state;
      subsystems = res.subsystems;
    }

    const drift = Vec3.length(Vec3.sub(state.position, startPos));
    const speed = Vec3.length(state.velocity);
    expect(drift).toBeLessThan(1);
    expect(speed).toBeLessThan(0.1);
  });
});
