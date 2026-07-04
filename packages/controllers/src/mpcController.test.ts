/**
 * MPCController unit tests — fake transport, no service required.
 */

import { boosterDescentScenario, Vec3 } from "@starship-catch-sim/physics";
import { describe, expect, it, vi } from "vitest";

import {
  MPCController,
  type MPCSolveRequest,
  type MPCSolveResponse,
} from "./mpcController.js";

function makeController(transport: (req: MPCSolveRequest) => Promise<MPCSolveResponse>) {
  const scenario = boosterDescentScenario();
  const ctl = new MPCController({
    vehicle: scenario.vehicle,
    targetPosition: scenario.targetCatch.targetPosition,
    transport,
    replanIntervalS: 1,
  });
  return { ctl, scenario };
}

/** A canned optimal 10 s plan that just descends vertically to the slot. */
function cannedResponse(): MPCSolveResponse {
  const n = 10;
  const positions = Array.from({ length: n + 1 }, (_, k) => ({
    x: 8.5,
    y: 1091 - (1000 * k) / n,
    z: 0,
  }));
  const velocities = Array.from({ length: n + 1 }, () => ({
    x: 0,
    y: -100,
    z: 0,
  }));
  const thrustAccel = Array.from({ length: n }, () => ({
    x: 0,
    y: 12,
    z: 0,
  }));
  return {
    status: "optimal",
    tFS: 10,
    solveTimeMs: 5,
    fuelKg: 1000,
    terminalSlack: 0,
    predictedPositions: positions,
    predictedVelocities: velocities,
    thrustAccel,
    throttle: new Array(n).fill(0.5) as number[],
  };
}

describe("MPCController", () => {
  it("falls back to PID before any plan arrives", () => {
    const never = vi.fn(() => new Promise<MPCSolveResponse>(() => undefined));
    const { ctl, scenario } = makeController(never);
    const input = ctl.step(scenario.initialWorld, 1 / 250);
    expect(ctl.isUsingFallback()).toBe(true);
    expect(Number.isFinite(input.gimbalPitch)).toBe(true);
    expect(never).toHaveBeenCalledTimes(1);
  });

  it("tracks the plan once a solve resolves, and notifies the observer", async () => {
    const transport = vi.fn(async () => cannedResponse());
    const { ctl, scenario } = makeController(transport);
    const observed: unknown[] = [];
    ctl.setPlanObserver((p) => observed.push(p));

    ctl.step(scenario.initialWorld, 1 / 250); // triggers request
    await Promise.resolve(); // let the transport promise settle
    await Promise.resolve();

    const input = ctl.step(scenario.initialWorld, 1 / 250);
    expect(ctl.isUsingFallback()).toBe(false);
    expect(observed).toHaveLength(1);
    // The canned plan demands up-thrust: engines must be lit.
    expect(input.enginesOn.centre).toBe(true);
    expect(input.engineGroups.centre).toBeGreaterThan(0);
  });

  it("respects the re-plan cadence (one request per interval)", async () => {
    const transport = vi.fn(async () => cannedResponse());
    const { ctl, scenario } = makeController(transport);
    const w = scenario.initialWorld;
    for (let i = 0; i < 100; i++) {
      ctl.step({ ...w, t: i * (1 / 250) }, 1 / 250);
    }
    await Promise.resolve();
    // 100 steps cover 0.4 s < 1 s cadence → exactly one request.
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("keeps flying PID when the solver reports non-optimal", async () => {
    const transport = vi.fn(async () => ({
      ...cannedResponse(),
      status: "infeasible",
    }));
    const { ctl, scenario } = makeController(transport);
    ctl.step(scenario.initialWorld, 1 / 250);
    await Promise.resolve();
    await Promise.resolve();
    ctl.step(scenario.initialWorld, 1 / 250);
    expect(ctl.isUsingFallback()).toBe(true);
  });

  it("keeps flying PID when the transport rejects", async () => {
    const transport = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const { ctl, scenario } = makeController(transport);
    ctl.step(scenario.initialWorld, 1 / 250);
    await Promise.resolve();
    await Promise.resolve();
    ctl.step(scenario.initialWorld, 1 / 250);
    expect(ctl.isUsingFallback()).toBe(true);
  });

  it("reset clears the plan and re-arms the fallback", async () => {
    const transport = vi.fn(async () => cannedResponse());
    const { ctl, scenario } = makeController(transport);
    ctl.step(scenario.initialWorld, 1 / 250);
    await Promise.resolve();
    await Promise.resolve();
    ctl.step(scenario.initialWorld, 1 / 250);
    expect(ctl.isUsingFallback()).toBe(false);

    ctl.reset();
    expect(ctl.getPlan()).toBeNull();
    expect(ctl.isUsingFallback()).toBe(true);
  });

  it("expired plan (t past tF) falls back to PID", async () => {
    const transport = vi.fn(async () => cannedResponse());
    const { ctl, scenario } = makeController(transport);
    const w0 = scenario.initialWorld;
    ctl.step(w0, 1 / 250);
    await Promise.resolve();
    await Promise.resolve();
    // 20 s later — the 10 s plan has expired.
    ctl.step({ ...w0, t: 20 }, 1 / 250);
    expect(ctl.isUsingFallback()).toBe(true);
  });

  it("sends a sane vehicle envelope in the request", async () => {
    let captured: MPCSolveRequest | null = null;
    const transport = vi.fn(async (req: MPCSolveRequest) => {
      captured = req;
      return cannedResponse();
    });
    const { ctl, scenario } = makeController(transport);
    ctl.step(scenario.initialWorld, 1 / 250);
    await Promise.resolve();
    expect(captured).not.toBeNull();
    const v = captured!.vehicle;
    // 13 landing engines × 2.05 MN sea-level ≈ 26.7 MN.
    expect(v.maxThrustN).toBeGreaterThan(20e6);
    expect(v.maxThrustN).toBeLessThan(35e6);
    // 3 centre engines at the 40 % floor ≈ 2.5 MN.
    expect(v.minThrustN).toBeGreaterThan(1e6);
    expect(v.minThrustN).toBeLessThan(5e6);
    expect(v.minThrustN).toBeLessThan(v.maxThrustN);
    expect(captured!.massKg).toBeGreaterThan(v.dryMassKg);
  });
});

describe("MPCController — plan interpolation", () => {
  it("commands descend-and-slow near the end of the plan", async () => {
    const transport = vi.fn(async () => cannedResponse());
    const { ctl, scenario } = makeController(transport);
    const w0 = scenario.initialWorld;
    ctl.step(w0, 1 / 250);
    await Promise.resolve();
    await Promise.resolve();

    // Mid-plan step: position exactly on the plan → pure feedforward.
    const onPlan = {
      ...w0,
      t: 5,
      rigidBody: {
        ...w0.rigidBody,
        position: Vec3.of(8.5, 591, 0),
        velocity: Vec3.of(0, -100, 0),
      },
    };
    const input = ctl.step(onPlan, 1 / 250);
    expect(ctl.isUsingFallback()).toBe(false);
    // Feedforward accel 12 m/s² on ~2.4e5 kg ≈ 2.9 MN ≈ 0.11 of max —
    // throttle ladder puts that all on the centre group.
    expect(input.engineGroups.centre).toBeGreaterThan(0.3);
    expect(input.engineGroups.outer).toBe(0);
  });
});
