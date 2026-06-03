import { describe, expect, it } from "vitest";

import { neutralControl, type ControlInput } from "./control.js";
import {
  BoosterVehicle,
  boosterDescentScenario,
} from "./scenarios.js";
import { simStep } from "./world.js";

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
    // Identity attitude + zero ω + no torques → rotation untouched.
    expect(world.rigidBody.attitude.w).toBeCloseTo(1, 6);
    expect(Math.abs(world.rigidBody.angularVelocity.x)).toBeLessThan(1e-6);
    expect(Math.abs(world.rigidBody.angularVelocity.y)).toBeLessThan(1e-6);
    expect(Math.abs(world.rigidBody.angularVelocity.z)).toBeLessThan(1e-6);
  });
});
