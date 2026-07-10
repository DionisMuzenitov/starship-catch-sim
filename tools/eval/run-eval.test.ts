/**
 * Smoke test of `pnpm eval:all --quick` — the matrix runner that CI
 * shells out to. Asserts a report is written, JSON-decodable, and has
 * the expected structure.
 */

import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runEvalSweep } from "./run-eval.js";

describe("runEvalSweep --quick", () => {
  it("writes a JSON report with the expected shape", () => {
    const dir = mkdtempSync(join(tmpdir(), "sls-eval-"));
    const reports = runEvalSweep({
      quick: true,
      outDir: dir,
      stamp: "test-stamp",
    });
    // Both the PID baseline and the neural policy run in the quick sweep.
    expect(reports.map((r) => r.controllerKey)).toEqual(["pid", "rl"]);
    for (const r of reports) {
      expect(r.seedsPerCell).toBe(3);
      expect(r.cells).toHaveLength(1);
      expect(r.cells[0]?.runs).toHaveLength(3);
    }

    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(2);

    // The neural policy must actually catch on the calm quick seeds — this is
    // the unit-level twin of the CI regression floor (SLS-66): a collapsed
    // policy (decode/physics regression) drops to ~0 and fails here too.
    const rl = reports.find((r) => r.controllerKey === "rl")!;
    expect(rl.cells[0]!.summary.successRate).toBeGreaterThanOrEqual(1 / 3);
  }, 120_000);
});
