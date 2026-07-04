/**
 * Async MC runner smoke test (SLS-27) — fake MPC transport, no HTTP.
 *
 * Asserts the MACHINERY works (runs complete, the MPC transport is
 * exercised, outcomes are classified) — NOT catch success: the PID
 * baseline + canned plan crash far from the tower on this scenario, and
 * controller quality is benchmarked in tools/eval/mpc-bench.ts, not here.
 */

import { describe, expect, it, vi } from "vitest";

import {
  MPCController,
  type MPCSolveResponse,
} from "../mpcController.js";
import { runMonteCarloAsync } from "./monteCarloAsync.js";

/** Canned optimal plan: 20 s vertical descent onto the slot. */
function cannedResponse(): MPCSolveResponse {
  const n = 20;
  return {
    status: "optimal",
    tFS: 20,
    solveTimeMs: 5,
    fuelKg: 1000,
    terminalSlack: 0,
    predictedPositions: Array.from({ length: n + 1 }, (_, k) => ({
      x: 8.5,
      y: 2091 - (2000 * k) / n,
      z: 0,
    })),
    predictedVelocities: Array.from({ length: n + 1 }, () => ({
      x: 0,
      y: -100,
      z: 0,
    })),
    thrustAccel: Array.from({ length: n }, () => ({ x: 0, y: 11, z: 0 })),
    throttle: new Array<number>(n).fill(0.4),
  };
}

describe("runMonteCarloAsync", () => {
  it(
    "runs 3 MPC seeds end-to-end with a fake transport",
    async () => {
      const transport = vi.fn(async () => cannedResponse());
      const result = await runMonteCarloAsync({
        scenarioId: "booster-descent-calm",
        nRuns: 3,
        environment: { windScale: 0 },
        controllerFactory: (scenario) =>
          Promise.resolve(
            new MPCController({
              vehicle: scenario.vehicle,
              targetPosition: scenario.targetCatch.targetPosition,
              transport,
            }),
          ),
      });

      expect(result.runs).toHaveLength(3);
      // The re-plan cadence fired: the transport saw real requests.
      expect(transport.mock.calls.length).toBeGreaterThan(0);
      for (const run of result.runs) {
        expect(run.outcomeKind).not.toBe("none");
        expect(Number.isFinite(run.durationS)).toBe(true);
        expect(Number.isFinite(run.terminalMetrics.distanceToTargetM)).toBe(
          true,
        );
      }
      expect(result.summary.successRate).toBeGreaterThanOrEqual(0);
      expect(result.summary.successRate).toBeLessThanOrEqual(1);
    },
    240_000,
  );

  it("awaits the onSimSecond hook once per sim-second", async () => {
    let hookCalls = 0;
    const transport = vi.fn(async () => cannedResponse());
    const result = await runMonteCarloAsync({
      scenarioId: "booster-descent-calm",
      nRuns: 1,
      seeds: [0],
      environment: { windScale: 0 },
      controllerFactory: (scenario) =>
        new MPCController({
          vehicle: scenario.vehicle,
          targetPosition: scenario.targetCatch.targetPosition,
          transport,
        }),
      onSimSecond: () => {
        hookCalls += 1;
        return Promise.resolve();
      },
    });
    const run = result.runs[0]!;
    // One hook call per started sim-second (±1 for the terminal tick).
    expect(hookCalls).toBeGreaterThanOrEqual(Math.floor(run.durationS));
    expect(hookCalls).toBeLessThanOrEqual(Math.ceil(run.durationS) + 1);
  }, 240_000);

  it("rejects unknown scenario ids", async () => {
    await expect(
      runMonteCarloAsync({
        scenarioId: "no-such-scenario",
        nRuns: 1,
        controllerFactory: () => {
          throw new Error("unreachable");
        },
      }),
    ).rejects.toThrow(/unknown scenario/);
  });
});
