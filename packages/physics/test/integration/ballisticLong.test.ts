import { describe, expect, it } from "vitest";

import { Quat } from "../../src/math/quat.js";
import { Vec3 } from "../../src/math/vec3.js";
import {
  currentInertia,
  currentMass,
  full,
} from "../../src/mass.js";
import { SuperHeavyMass } from "../../src/presets/super-heavy.js";
import { constantWind } from "../../src/wind.js";
import { runStep } from "./runStep.js";
import type { RigidBodyState } from "../../src/state.js";

/**
 * Drop the booster (no thrust, no fins active) from 50 km and let drag +
 * gravity run for 30 s. Assert key trajectory invariants — these are robust
 * to small numerical changes but catch any gross physics regression.
 */
describe("integration: ballisticLong", () => {
  it("50 km drop, gravity + drag only: trajectory invariants", () => {
    const mp = full(SuperHeavyMass);
    let state: RigidBodyState = {
      position: Vec3.of(0, 50_000, 0),
      velocity: Vec3.ZERO,
      attitude: Quat.IDENTITY,
      angularVelocity: Vec3.ZERO,
      mass: currentMass(mp),
      inertia: currentInertia(mp),
    };

    let subsystems = {
      engineStates: [],
      surfaceStates: [],
      massProps: mp,
    };

    const wind = constantWind(Vec3.ZERO);
    const dt = 0.01;
    const T = 30;
    const N = Math.round(T / dt);

    // Booster reference area & coarse Cd for the tube-on-end orientation.
    const refArea = Math.PI * 4.5 * 4.5;
    const cd = 0.8;

    const samples: Array<{ t: number; y: number; vy: number }> = [];
    for (let i = 0; i < N; i++) {
      if (i % 300 === 0) {
        samples.push({
          t: i * dt,
          y: state.position.y,
          vy: state.velocity.y,
        });
      }
      const res = runStep(
        state,
        subsystems,
        { engineCommands: [], surfaceTargets: [] },
        { engines: [], surfaces: [], refArea, cd },
        wind,
        i * dt,
        dt,
      );
      state = res.state;
      subsystems = res.subsystems;
    }

    // Invariants:
    // 1. The body has fallen (velocity is downward and large).
    expect(state.velocity.y).toBeLessThan(-100);
    // 2. It has lost altitude.
    expect(state.position.y).toBeLessThan(50_000);
    // 3. With no horizontal force or initial horizontal velocity, x and z
    //    motion stays effectively zero.
    expect(Math.abs(state.position.x)).toBeLessThan(1e-6);
    expect(Math.abs(state.position.z)).toBeLessThan(1e-6);
    // 4. Attitude unchanged (no torques applied).
    expect(Quat.equalsRotation(state.attitude, Quat.IDENTITY, 1e-9)).toBe(true);
    // 5. Trajectory samples are monotonically decreasing in altitude.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.y).toBeLessThan(samples[i - 1]!.y);
    }
  });
});
