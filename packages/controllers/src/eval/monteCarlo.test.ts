/**
 * Smoke test of the generic SLS-24 MC harness. CI runs this against a
 * 3-seed BoosterDescentCalm + PID, plus a wind-scale sweep, to catch
 * regressions in the harness wiring without paying for a 30-seed sweep.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PID_GAINS,
  PIDController,
  runMonteCarlo,
  scaleWind,
  windScaleSweep,
} from "../index.js";
import { constantWind, Vec3 } from "@starship-catch-sim/physics";

describe("runMonteCarlo", () => {
  it("runs 3 seeds end-to-end and produces a finite summary", () => {
    const result = runMonteCarlo({
      scenarioId: "booster-descent-calm",
      nRuns: 3,
      controllerFactory: (scenario) =>
        new PIDController(
          scenario.vehicle,
          scenario.targetCatch.targetPosition,
          () => DEFAULT_PID_GAINS,
        ),
    });
    expect(result.runs).toHaveLength(3);
    for (const r of result.runs) {
      expect(r.outcomeKind).not.toBe("none");
      expect(Number.isFinite(r.terminalMetrics.distanceToTargetM)).toBe(true);
      expect(Number.isFinite(r.fuelUsedKg)).toBe(true);
      expect(r.runtimeMs).toBeGreaterThanOrEqual(0);
    }
    expect(result.summary.successRate).toBeGreaterThanOrEqual(0);
    expect(result.summary.successRate).toBeLessThanOrEqual(1);
    expect(Number.isFinite(result.summary.medianFinalPosErrM)).toBe(true);
    expect(Number.isFinite(result.summary.medianFuelKg)).toBe(true);
    expect(Number.isFinite(result.summary.p99RuntimeMs)).toBe(true);
  }, 120_000);

  it("respects an explicit seed list", () => {
    const result = runMonteCarlo({
      scenarioId: "booster-descent-calm",
      nRuns: 3,
      seeds: [101, 102],
      controllerFactory: (scenario) =>
        new PIDController(
          scenario.vehicle,
          scenario.targetCatch.targetPosition,
          () => DEFAULT_PID_GAINS,
        ),
    });
    expect(result.runs.map((r) => r.seed)).toEqual([101, 102]);
  }, 60_000);

  it("rejects an unknown scenarioId", () => {
    expect(() =>
      runMonteCarlo({
        scenarioId: "does-not-exist",
        nRuns: 1,
        controllerFactory: (scenario) =>
          new PIDController(
            scenario.vehicle,
            scenario.targetCatch.targetPosition,
            () => DEFAULT_PID_GAINS,
          ),
      }),
    ).toThrow(/unknown scenario/);
  });
});

describe("windScaleSweep", () => {
  it("returns one MC result per windScale, all with finite summaries", () => {
    const results = windScaleSweep(
      {
        scenarioId: "booster-descent-calm",
        nRuns: 1,
        controllerFactory: (scenario) =>
          new PIDController(
            scenario.vehicle,
            scenario.targetCatch.targetPosition,
            () => DEFAULT_PID_GAINS,
          ),
      },
      [0, 1],
    );
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.windScale)).toEqual([0, 1]);
    for (const r of results) {
      expect(Number.isFinite(r.summary.successRate)).toBe(true);
    }
  }, 120_000);
});

describe("scaleWind", () => {
  it("multiplies wind output by k", () => {
    const base = constantWind(Vec3.of(5, 0, 0));
    const scaled = scaleWind(base, 3);
    expect(scaled.at(Vec3.ZERO, 0)).toEqual(Vec3.of(15, 0, 0));
  });

  it("returns the original field when k === 1 (preserves PRNG state)", () => {
    const base = constantWind(Vec3.of(5, 0, 0));
    expect(scaleWind(base, 1)).toBe(base);
  });
});
