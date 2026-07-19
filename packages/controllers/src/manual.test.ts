import {
  BoosterVehicle,
  ShipDescentCalm,
  boosterDescentScenario,
  simStep,
} from "@starship-catch-sim/physics";
import { describe, expect, it } from "vitest";

import { ManualController, createManualInputState } from "./manual.js";

const DT = 1 / 250;

describe("ManualController", () => {
  it("W (throttle up) raises the selected group's throttle", () => {
    const input = createManualInputState();
    const ctl = new ManualController(BoosterVehicle, input);
    const world = boosterDescentScenario().initialWorld;

    input.throttleUp = true;
    input.ignite = true;
    const out = ctl.step(world, DT);

    expect(out.engineGroups.centre).toBeGreaterThan(0);
    expect(out.enginesOn.centre).toBe(true);
  });

  it("Shift+W snaps throttle to full", () => {
    const input = createManualInputState();
    const ctl = new ManualController(BoosterVehicle, input);
    const world = boosterDescentScenario().initialWorld;

    input.fullThrottle = true;
    input.ignite = true;
    const out = ctl.step(world, DT);

    expect(out.engineGroups.centre).toBe(1);
  });

  it("X (engine cutoff) zeroes throttle and turns engines off", () => {
    const input = createManualInputState();
    const ctl = new ManualController(BoosterVehicle, input);
    const world = boosterDescentScenario().initialWorld;

    input.fullThrottle = true;
    input.ignite = true;
    ctl.step(world, DT);
    input.fullThrottle = false;
    input.ignite = false;
    input.engineCutoff = true;
    const out = ctl.step(world, DT);

    expect(out.engineGroups.centre).toBe(0);
    expect(out.engineGroups.inner).toBe(0);
    expect(out.engineGroups.outer).toBe(0);
    expect(out.enginesOn.centre).toBe(false);
  });

  it("arrow keys move the gimbal targets", () => {
    const input = createManualInputState();
    const ctl = new ManualController(BoosterVehicle, input);
    const world = boosterDescentScenario().initialWorld;

    input.pitchUp = true;
    input.yawRight = true;
    for (let i = 0; i < 10; i++) ctl.step(world, DT);
    const out = ctl.step(world, DT);

    expect(out.gimbalPitch).toBeGreaterThan(0);
    expect(out.gimbalYaw).toBeGreaterThan(0);
  });

  it("group selector routes W/S to the chosen group", () => {
    const input = createManualInputState();
    const ctl = new ManualController(BoosterVehicle, input);
    const world = boosterDescentScenario().initialWorld;

    input.selectedGroup = "outer";
    input.throttleUp = true;
    input.ignite = true;
    for (let i = 0; i < 50; i++) ctl.step(world, DT);
    const out = ctl.step(world, DT);

    expect(out.engineGroups.outer).toBeGreaterThan(0);
    expect(out.engineGroups.centre).toBe(0);
  });

  it("flies the Starship ship engine group: select 4, ignite, throttle → burns fuel (SLS-81)", () => {
    // Regression: the ship's 6 Raptors are all one `ship` group. Before
    // SLS-81 no key selected it and PID/RL ignored it, so the ship scenario
    // looked dead. Manual selects the group (`4`), ignites, and throttles.
    const input = createManualInputState();
    const ctl = new ManualController(ShipDescentCalm.vehicle, input);
    input.selectedGroup = "ship";
    input.ignite = true;
    input.fullThrottle = true;

    const out = ctl.step(ShipDescentCalm.initialWorld, DT);
    expect(out.engineGroups.ship).toBe(1);
    expect(out.enginesOn.ship).toBe(true);
    // Booster groups stay dead — the ship has none of them.
    expect(out.engineGroups.centre).toBe(0);

    // Closed-loop: stepping the plant actually consumes propellant.
    let world = ShipDescentCalm.initialWorld;
    const fuel0 = world.mass.propellantMass;
    for (let i = 0; i < 250; i++) {
      const u = ctl.step(world, DT);
      world = simStep(world, ShipDescentCalm.vehicle, u, DT, ShipDescentCalm.env);
    }
    expect(world.mass.propellantMass).toBeLessThan(fuel0);
  });

  it("right-mouse-drag pointerDx/Dy feed gimbal targets", () => {
    const input = createManualInputState();
    const ctl = new ManualController(BoosterVehicle, input);
    const world = boosterDescentScenario().initialWorld;

    input.pointerDx = 50;
    input.pointerDy = -30;
    const out = ctl.step(world, DT);

    expect(out.gimbalYaw).toBeGreaterThan(0);
    expect(out.gimbalPitch).toBeLessThan(0);
    // Pointer deltas are consumed (zeroed) so they don't reapply.
    expect(input.pointerDx).toBe(0);
    expect(input.pointerDy).toBe(0);
  });

  it("F (fins deployed) sets fin deflection targets", () => {
    const input = createManualInputState();
    const ctl = new ManualController(BoosterVehicle, input);
    const world = boosterDescentScenario().initialWorld;

    input.finsDeployed = true;
    const out = ctl.step(world, DT);

    expect(out.fins.length).toBe(4);
    expect(out.fins.every((f) => f > 0)).toBe(true);
  });
});
