/**
 * Smoke test of `pnpm eval:all --quick` — the matrix runner that CI
 * shells out to. Asserts a report is written, JSON-decodable, and has
 * the expected structure.
 */

import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
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
    expect(reports).toHaveLength(1);
    const r = reports[0]!;
    expect(r.controllerKey).toBe("pid");
    expect(r.seedsPerCell).toBe(3);
    expect(r.cells).toHaveLength(1);
    expect(r.cells[0]?.runs).toHaveLength(3);

    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(1);
    const payload = JSON.parse(readFileSync(join(dir, files[0]!), "utf8"));
    expect(payload.controllerKey).toBe("pid");
    expect(payload.cells[0].summary.successRate).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
