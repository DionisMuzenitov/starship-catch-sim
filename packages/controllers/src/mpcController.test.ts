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

  it("rejects slack-soaked plans (optimal status but unreachable target)", async () => {
    // The service's always-feasible relaxation reports `optimal` from any
    // IC — a huge terminalSlack means "no real solution". Tracking such a
    // plan is worse than the PID fallback (found by the SLS-27 bench:
    // 70 km terminal error vs PID's 21 km).
    const transport = vi.fn(async () => ({
      ...cannedResponse(),
      terminalSlack: 870,
    }));
    const { ctl, scenario } = makeController(transport);
    ctl.step(scenario.initialWorld, 1 / 250);
    await Promise.resolve();
    await Promise.resolve();
    ctl.step(scenario.initialWorld, 1 / 250);
    expect(ctl.isUsingFallback()).toBe(true);
    expect(ctl.getPlan()).toBeNull();
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

describe("MPCController — floor-aware thrust allocation (SLS-48)", () => {
  // Booster groups (sea-level thrust 2.05 MN/engine, floor 0.4):
  //   centre (3): band [2.46, 6.15] MN
  //   +inner (10): band [10.66, 26.65] MN
  //   +outer (20): band [43.05, 67.65] MN
  // Access the private method via a step() probe: inject a plan whose
  // feedforward demands a known accel and inspect the engine groups.
  async function groupsForAccel(aY: number) {
    const scenario = boosterDescentScenario();
    const n = 10;
    const resp: MPCSolveResponse = {
      status: "optimal",
      tFS: 10,
      solveTimeMs: 1,
      fuelKg: 100,
      terminalSlack: 0,
      predictedPositions: Array.from({ length: n + 1 }, () => ({
        ...scenario.initialWorld.rigidBody.position,
      })),
      predictedVelocities: Array.from({ length: n + 1 }, () => ({
        ...scenario.initialWorld.rigidBody.velocity,
      })),
      thrustAccel: Array.from({ length: n }, () => ({ x: 0, y: aY, z: 0 })),
      throttle: new Array(n).fill(0.5) as number[],
    };
    const ctl = new MPCController({
      vehicle: scenario.vehicle,
      targetPosition: scenario.targetCatch.targetPosition,
      transport: async () => resp,
      replanIntervalS: 1,
    });
    ctl.step(scenario.initialWorld, 1 / 250);
    await Promise.resolve();
    await Promise.resolve();
    // Position/velocity match the plan exactly → zero PD correction.
    return ctl.step(scenario.initialWorld, 1 / 250).engineGroups;
  }

  it("small demand lights ONLY the centre engines (never the inner ring)", async () => {
    // 5 m/s² on ~527 t ≈ 2.6 MN — inside the centre band. The old
    // proportional ladder lit the inner ring here, and the plant's
    // per-engine floor then delivered ~4× the demand (tank drained in
    // 18 s, MPC flew worse than PID).
    const g = await groupsForAccel(5);
    expect(g.centre).toBeGreaterThan(0);
    expect(g.inner).toBe(0);
    expect(g.outer).toBe(0);
  });

  it("demand just above the centre band stays centre-only at full (nearest endpoint)", async () => {
    // 12 m/s² ≈ 6.3 MN: centre max is 6.15 MN, centre+inner floor is
    // 10.66 MN → 6.15 is closer; do not light 10 engines for a 0.15 MN
    // shortfall.
    const g = await groupsForAccel(12);
    expect(g.centre).toBe(1);
    expect(g.inner).toBe(0);
  });

  it("large demand engages the inner ring above its floor", async () => {
    // 40 m/s² ≈ 21.1 MN: inside the centre+inner band [10.66, 26.65].
    const g = await groupsForAccel(40);
    expect(g.centre).toBeGreaterThan(0.6);
    expect(g.inner).toBeGreaterThan(0.6);
    expect(g.outer).toBe(0);
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
