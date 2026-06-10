import { describe, expect, it } from "vitest";

import { initialSurfaceState } from "./aero.js";
import { neutralControl, type ControlInput } from "./control.js";
import { full, tankCapacity, consumeFuel, currentInertia, currentMass } from "./mass.js";
import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";
import { BoosterFins } from "./presets/booster-fins.js";
import { SuperHeavyEngines } from "./presets/super-heavy-engines.js";
import { SuperHeavyMass } from "./presets/super-heavy.js";
import { createRigidBody } from "./state.js";
import { initialEngineState } from "./thrust.js";
import { constantWind } from "./wind.js";
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
    const v0 = world.rigidBody.velocity.y;
    const ctl = fullThrottle();
    for (let i = 0; i < 500; i++) {
      world = simStep(world, BoosterVehicle, ctl, DT);
    }
    // 33 Raptors at full chat oriented retrograde should slow the
    // descent. From the scenario IC (vy = -200 m/s) the booster needs
    // many seconds to reverse fully; over 2 s of sim the descent rate
    // should have eased substantially toward zero.
    expect(world.rigidBody.velocity.y).toBeGreaterThan(v0);
    expect(world.rigidBody.velocity.y).toBeGreaterThan(-150);
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
    const q0 = world.rigidBody.attitude;
    const ctl = neutralControl(BoosterVehicle.surfaces.length, 0);
    for (let i = 0; i < 250; i++) {
      world = simStep(world, BoosterVehicle, ctl, DT);
    }
    // Attitude drift is small but nonzero — at 65 km the residual air
    // density is ~6e-4 kg/m³ and a 360 m/s descent generates a small
    // aero torque on the fins.
    expect(world.rigidBody.attitude.x).toBeCloseTo(q0.x, 2);
    expect(world.rigidBody.attitude.y).toBeCloseTo(q0.y, 2);
    expect(world.rigidBody.attitude.z).toBeCloseTo(q0.z, 2);
    expect(world.rigidBody.attitude.w).toBeCloseTo(q0.w, 2);
    expect(Math.abs(world.rigidBody.angularVelocity.x)).toBeLessThan(1e-3);
    expect(Math.abs(world.rigidBody.angularVelocity.y)).toBeLessThan(1e-3);
    expect(Math.abs(world.rigidBody.angularVelocity.z)).toBeLessThan(1e-3);
  });
});

describe("simStep — wind plumbing (SimEnv)", () => {
  // Build a synthetic world at low altitude where wind actually exerts
  // measurable drag (the canonical scenarios start at 65 km where the
  // atmosphere is too thin for wind to do much over short rolls).
  function lowAltitudeWorld(): import("./world.js").World {
    const mass = full(SuperHeavyMass);
    const drained = consumeFuel(mass, 0.5 * tankCapacity(mass));
    return {
      rigidBody: createRigidBody({
        mass: currentMass(drained),
        inertia: currentInertia(drained),
        position: Vec3.of(0, 100, 0),
        velocity: Vec3.ZERO,
        attitude: Quat.IDENTITY,
        angularVelocity: Vec3.ZERO,
      }),
      mass: drained,
      engineStates: SuperHeavyEngines.map(() => initialEngineState()),
      surfaceStates: BoosterFins.map(() => initialSurfaceState()),
      t: 0,
    };
  }

  it("steady eastward wind drags the body eastward when otherwise at rest", () => {
    const ctl = neutralControl(BoosterVehicle.surfaces.length, 0);
    let world = lowAltitudeWorld();
    const windyEnv = {
      wind: constantWind(Vec3.of(30, 0, 0)),
      gravity: 9.80665,
    };
    for (let i = 0; i < 200; i++) {
      world = simStep(world, BoosterVehicle, ctl, DT, windyEnv);
    }
    expect(world.rigidBody.velocity.x).toBeGreaterThan(0);
  });

  it("zero wind leaves horizontal velocity unchanged from rest", () => {
    const ctl = neutralControl(BoosterVehicle.surfaces.length, 0);
    let world = lowAltitudeWorld();
    for (let i = 0; i < 200; i++) {
      world = simStep(world, BoosterVehicle, ctl, DT);
    }
    expect(Math.abs(world.rigidBody.velocity.x)).toBeLessThan(1e-9);
    expect(Math.abs(world.rigidBody.velocity.z)).toBeLessThan(1e-9);
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
