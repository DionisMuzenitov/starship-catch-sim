import { describe, expect, it } from "vitest";

import { initialSurfaceState } from "./aero.js";
import { neutralControl, type ControlInput } from "./control.js";
import { full } from "./mass.js";
import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";
import { BoosterFins } from "./presets/booster-fins.js";
import { SuperHeavyEngines } from "./presets/super-heavy-engines.js";
import { SuperHeavyMass } from "./presets/super-heavy.js";
import { createRigidBody } from "./state.js";
import { initialEngineState } from "./thrust.js";
import {
  BoosterVehicle,
  boosterDescentScenario,
} from "./scenarios.js";
import { createWorld, defineVehicle, simStep } from "./world.js";

const DT = 1 / 250;

function fullThrottle(): ControlInput {
  const base = neutralControl(BoosterVehicle.surfaces.length, 0);
  return {
    ...base,
    engineGroups: { centre: 1, inner: 1, outer: 1, ship: 0 },
    enginesOn: { centre: true, inner: true, outer: true, ship: false },
  };
}

describe("simStep — booster descent scenario", () => {
  it("engines-off lets the booster accelerate downward under gravity", () => {
    let world = boosterDescentScenario().initialWorld;
    const ctl = neutralControl(BoosterVehicle.surfaces.length, 0);
    const v0 = world.rigidBody.velocity.y;
    for (let i = 0; i < 250; i++) {
      world = simStep(world, BoosterVehicle, ctl, DT);
    }
    expect(world.rigidBody.velocity.y).toBeLessThan(v0);
    expect(world.t).toBeCloseTo(1, 6);
  });

  it("full throttle from descent flips vertical acceleration positive", () => {
    let world = boosterDescentScenario().initialWorld;
    const ctl = fullThrottle();
    for (let i = 0; i < 500; i++) {
      world = simStep(world, BoosterVehicle, ctl, DT);
    }
    // 33 Raptors at full chat should outweigh gravity for the loaded
    // booster — the descent should slow then reverse.
    expect(world.rigidBody.velocity.y).toBeGreaterThan(-20);
  });

  it("burning propellant strictly decreases mass", () => {
    let world = boosterDescentScenario().initialWorld;
    const ctl = fullThrottle();
    const m0 = world.mass.propellantMass;
    for (let i = 0; i < 250; i++) {
      world = simStep(world, BoosterVehicle, ctl, DT);
    }
    expect(world.mass.propellantMass).toBeLessThan(m0);
    // Rigid-body mass field stays in sync with MassProperties.
    expect(world.rigidBody.mass).toBeCloseTo(
      world.mass.dryMass + world.mass.propellantMass,
      3,
    );
  });

  it("idle controls leave attitude unchanged after many steps", () => {
    let world = boosterDescentScenario().initialWorld;
    const ctl = neutralControl(BoosterVehicle.surfaces.length, 0);
    for (let i = 0; i < 250; i++) {
      world = simStep(world, BoosterVehicle, ctl, DT);
    }
    expect(world.rigidBody.attitude.w).toBeCloseTo(1, 6);
    expect(Math.abs(world.rigidBody.angularVelocity.x)).toBeLessThan(1e-6);
    expect(Math.abs(world.rigidBody.angularVelocity.y)).toBeLessThan(1e-6);
    expect(Math.abs(world.rigidBody.angularVelocity.z)).toBeLessThan(1e-6);
  });
});

describe("defineVehicle", () => {
  it("throws when engineGroupOf length doesn't match engines", () => {
    expect(() =>
      defineVehicle({
        engines: SuperHeavyEngines,
        engineGroupOf: ["centre"],
        surfaces: BoosterFins,
        bodyRefArea: 1,
        bodyCd: 1,
      }),
    ).toThrow(/engineGroupOf length/);
  });

  it("assigns separate index spaces to fin vs flap surfaces", () => {
    const finSurface = BoosterFins[0]!;
    const flapSurface = { ...finSurface, kind: "flap" as const };
    const v = defineVehicle({
      engines: [],
      engineGroupOf: [],
      surfaces: [finSurface, flapSurface, finSurface, flapSurface],
      bodyRefArea: 0,
      bodyCd: 0,
    });
    expect(v.surfaceCtlIndexOf).toEqual([0, 0, 1, 1]);
  });
});

describe("createWorld", () => {
  it("builds a World with initialised engine + surface states", () => {
    const mass = full(SuperHeavyMass);
    const rb = createRigidBody({
      mass: 1,
      inertia: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      position: Vec3.of(0, 100, 0),
      attitude: Quat.IDENTITY,
    });
    const world = createWorld({ vehicle: BoosterVehicle, mass, rigidBody: rb });
    expect(world.t).toBe(0);
    expect(world.engineStates.length).toBe(SuperHeavyEngines.length);
    expect(world.engineStates[0]).toEqual(initialEngineState());
    expect(world.surfaceStates.length).toBe(BoosterFins.length);
    expect(world.surfaceStates[0]).toEqual(initialSurfaceState());
  });

  it("respects an explicit initial t", () => {
    const mass = full(SuperHeavyMass);
    const rb = createRigidBody({
      mass: 1,
      inertia: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    });
    const world = createWorld({
      vehicle: BoosterVehicle,
      mass,
      rigidBody: rb,
      t: 42,
    });
    expect(world.t).toBe(42);
  });
});
