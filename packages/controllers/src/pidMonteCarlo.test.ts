/**
 * 3-seed smoke test of the headless PID MC harness. CI runs this to catch
 * regressions in the headless wiring; the 30-seed full pass is run on
 * demand via `pnpm eval:pid`.
 */

import { describe, expect, it } from "vitest";

import { evalPidMonteCarlo } from "../../../tools/eval/pid-monte-carlo.js";

describe("pid monte-carlo harness", () => {
  it("runs 3 seeds end-to-end and reports a finite success rate", () => {
    const { seeds, successRate } = evalPidMonteCarlo(3);
    expect(seeds.length).toBe(3);
    for (const s of seeds) {
      expect(Number.isFinite(s.finalY)).toBe(true);
      expect(Number.isFinite(s.distanceToTargetM)).toBe(true);
      expect(s.outcomeKind).not.toBe("none");
    }
    expect(successRate).toBeGreaterThanOrEqual(0);
    expect(successRate).toBeLessThanOrEqual(1);
  }, 120_000);
});
