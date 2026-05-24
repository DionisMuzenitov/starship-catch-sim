import { describe, expect, it } from "vitest";

import { initialSurfaceState } from "../../src/aero.js";
import { Quat } from "../../src/math/quat.js";
import { Vec3 } from "../../src/math/vec3.js";
import {
  currentInertia,
  currentMass,
  full,
} from "../../src/mass.js";
import { BoosterFins } from "../../src/presets/booster-fins.js";
import { SuperHeavyMass } from "../../src/presets/super-heavy.js";
import { constantWind } from "../../src/wind.js";
import { runStep } from "./runStep.js";
import type { RigidBodyState } from "../../src/state.js";

/**
 * Booster from a stage-separation-like state (65 km altitude, 1500 m/s
 * downward), engines off, fins extended (deflection 0). Run for 60 s of
 * sim time and check the trajectory stays sane — falling, slowing as drag
 * builds, no spurious horizontal motion or unprovoked attitude excursion.
 *
 * This is the most "lifelike" integration scenario and the one most likely
 * to surface integration bugs between subsystems.
 */
describe("integration: stagedDescent", () => {
  it("60 s of fins-deployed engines-off descent stays well-behaved", () => {
    const mp = full(SuperHeavyMass);
    let state: RigidBodyState = {
      position: Vec3.of(0, 65_000, 0),
      velocity: Vec3.of(0, -1500, 0),
      attitude: Quat.IDENTITY,
      angularVelocity: Vec3.ZERO,
      mass: currentMass(mp),
      inertia: currentInertia(mp),
    };

    let subsystems = {
      engineStates: [],
      surfaceStates: BoosterFins.map(() => initialSurfaceState()),
      massProps: mp,
    };

    const wind = constantWind(Vec3.ZERO);
    const dt = 0.01;
    const T_MAX = 60;
    const N_MAX = Math.round(T_MAX / dt);

    const refArea = Math.PI * 4.5 * 4.5;
    const cd = 0.8;

    // The integrator has no ground-collision model — that lands with the
    // scenario tickets in M3. To keep this test focused on descent
    // dynamics (not what happens *below* ground), break out as soon as we
    // pass through y = 0.
    let steps = 0;
    for (let i = 0; i < N_MAX; i++) {
      const res = runStep(
        state,
        subsystems,
        {
          engineCommands: [],
          surfaceTargets: BoosterFins.map(() => 0),
        },
        { engines: [], surfaces: BoosterFins, refArea, cd },
        wind,
        i * dt,
        dt,
      );
      state = res.state;
      subsystems = res.subsystems;
      steps++;
      if (state.position.y <= 0) break;
    }

    // Invariants:
    // 0. We actually ran some simulation (didn't break out immediately).
    expect(steps).toBeGreaterThan(100);
    // 1. Booster has descended significantly from 65 km.
    expect(state.position.y).toBeLessThan(65_000);
    // 2. Vertical velocity is still downward.
    expect(state.velocity.y).toBeLessThan(0);
    // 3. With no torque or horizontal wind, attitude and lateral motion
    //    stay essentially nominal.
    expect(Math.abs(state.position.x)).toBeLessThan(1e-6);
    expect(Math.abs(state.position.z)).toBeLessThan(1e-6);
    expect(Vec3.length(state.angularVelocity)).toBeLessThan(1e-6);
    expect(Quat.equalsRotation(state.attitude, Quat.IDENTITY, 1e-9)).toBe(true);
    // 4. Mass is unchanged (engines off, no fuel burn).
    expect(state.mass).toBeCloseTo(currentMass(mp), 6);
  });
});
