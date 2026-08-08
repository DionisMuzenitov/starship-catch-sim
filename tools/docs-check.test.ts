import { describe, expect, it } from "vitest";

import { ratesByScenario } from "./eval/generations";
import {
  canonicalRates,
  checkReadmeResultsTable,
  classifyStatus,
  repoRoot,
  runAllChecks,
  sweepBenchClaims,
  sweepTargets,
} from "./docs-check";

// Keyed by generation label (tools/eval/generations.ts).
const CANON = { PID: [0, 0, 0], MPC: [53, 50, 50], "Neural policy": [87, 87, 90] };

const RESULTS_TABLE = [
  "## Results",
  "",
  "| Controller | Calm | Standard | Stormy |",
  "| --- | --- | --- | --- |",
  "| Cascaded PID (M4) | 0 % | 0 % | 0 % |",
  "| Convex MPC (M5) | 53 % | 50 % | 50 % |",
  "| **Neural policy (M6)** | **87 %** | **87 %** | **90 %** |",
].join("\n");

describe("docs-check (SLS-107)", () => {
  it("classifyStatus buckets the real status-line vocabulary", () => {
    expect(classifyStatus("Accepted")).toBe("accepted");
    expect(classifyStatus("Accepted (tower premise amended by 018)")).toBe("accepted");
    expect(classifyStatus("Proposed")).toBe("proposed");
    expect(classifyStatus("Superseded by ADR-016")).toBe("superseded");
    expect(classifyStatus("wat")).toBe("unknown");
  });

  it("canonicalRates reads both gate-record shapes and matches the published headline", () => {
    const canon = canonicalRates(repoRoot);
    // v2 acceptance baseline (SLS-93), ±20 m entry corridor, held-out seeds.
    expect(canon["Neural policy"]).toEqual([96, 59, 36]); // v2-acceptance-rl.json
    expect(canon["MPC"]).toEqual([49, 37, 39]); // v2-acceptance-mpc.json
    expect(canon["PID"]).toEqual([0, 0, 0]);
  });

  it("ratesByScenario never trusts cell emission order", () => {
    // Distinct scenarioIds, deliberately shuffled (stormy first).
    const shuffled = [
      { scenarioId: "booster-descent-stormy", windScale: 1, summary: { successRate: 0.9 } },
      { scenarioId: "booster-descent-calm", windScale: 1, summary: { successRate: 0.87 } },
      { scenarioId: "booster-descent-standard", windScale: 1, summary: { successRate: 0.87 } },
    ];
    expect(ratesByScenario(shuffled)).toEqual({ calm: 0.87, standard: 0.87, stormy: 0.9 });
    // Single-scenario wind sweep (the M5 shape), shuffled by windScale.
    const windSweep = [
      { scenarioId: "booster-descent-calm", windScale: 2, summary: { successRate: 0.5 } },
      { scenarioId: "booster-descent-calm", windScale: 0, summary: { successRate: 0.53 } },
      { scenarioId: "booster-descent-calm", windScale: 1, summary: { successRate: 0.5 } },
    ];
    expect(ratesByScenario(windSweep)).toEqual({ calm: 0.53, standard: 0.5, stormy: 0.5 });
  });

  it("README table check passes on matching numbers and flags a stale cell by scenario name", () => {
    expect(checkReadmeResultsTable(RESULTS_TABLE, CANON)).toEqual([]);
    const stale = RESULTS_TABLE.replace("**90 %**", "**80 %**");
    const failures = checkReadmeResultsTable(stale, CANON);
    expect(failures).toHaveLength(1);
    expect(failures[0].detail).toContain("stormy column");
    expect(failures[0].detail).toContain("README says 80 %");
    expect(failures[0].detail).toContain("gate record says 90 %");
  });

  it("README row lookup is scoped to the Results section (milestone table can't shadow it)", () => {
    // Milestone-style table BEFORE the Results section mentions "Convex MPC"
    // with no % cells — the old first-match lookup latched onto it.
    const readme = ["## Milestones", "", "| M5 | Convex MPC guidance | Done |", "", RESULTS_TABLE].join("\n");
    expect(checkReadmeResultsTable(readme, CANON)).toEqual([]);
    // A README without a Results section is itself a failure, not a silent pass.
    const noSection = "## Milestones\n\n| M5 | Convex MPC guidance | Done |";
    expect(checkReadmeResultsTable(noSection, CANON)[0].detail).toContain('no "## Results" section');
  });

  it("bench-claim sweep catches the ADR-023 contradiction class", () => {
    // The exact sentence the 2026-07-25 audit found stale in ADR-023.
    const text = "The realistic fix is exactly what the MPC already does — and the MPC catches 0 % in this sim.";
    const failures = sweepBenchClaims("docs/adr/023.md", text, CANON);
    expect(failures).toHaveLength(1);
    expect(failures[0].detail).toContain("MPC catches 0 %");
  });

  it("sweep sees claims hard-wrapped across lines, slash lists, and possessives", () => {
    // README footnote shape: claim wrapped across two source lines + slash list.
    const wrapped = "the in-browser neural policy catches\n**87 / 87 / 90 %** (calm/standard/stormy) versus";
    expect(sweepBenchClaims("x.md", wrapped, CANON)).toEqual([]);
    const wrappedStale = "the in-browser neural policy catches\n**87 / 87 / 80 %** (calm/standard/stormy)";
    const failures = sweepBenchClaims("x.md", wrappedStale, CANON);
    expect(failures).toHaveLength(1);
    expect(failures[0].detail).toContain("80 %");
    // Possessive form.
    expect(sweepBenchClaims("x.md", "versus MPC's 53 / 50 / 50 %", CANON)).toEqual([]);
    expect(sweepBenchClaims("x.md", "versus MPC's 53 / 40 / 50 %", CANON)).toHaveLength(1);
  });

  it("sweep accepts record numbers including ranges, rejects off-record endpoints", () => {
    const ok = [
      "an imitation-learned neural policy that catches the booster 87–90 % of the time",
      "the MPC catches 53 % on the calm cell",
      "PID catches 0 % across all cells",
    ].join("\n\n");
    expect(sweepBenchClaims("x.md", ok, CANON)).toEqual([]);
    const bad = "the neural policy catches 60–90 % of the time";
    expect(sweepBenchClaims("x.md", bad, CANON)).toHaveLength(1);
  });

  it("ignore marker: same line or a STANDALONE marker line above — nothing else", () => {
    const sameLine = "the MPC gets 0 % <!-- docs-check:ignore historical, pre-SLS-47 -->";
    expect(sweepBenchClaims("x.md", sameLine, CANON)).toEqual([]);
    const standaloneAbove = "<!-- docs-check:ignore historical -->\nthe MPC gets 0 % here";
    expect(sweepBenchClaims("x.md", standaloneAbove, CANON)).toEqual([]);
    // Without a marker the same text fails — the marker is load-bearing.
    expect(sweepBenchClaims("x.md", "the MPC gets 0 % here", CANON)).toHaveLength(1);
    // An INLINE marker on the previous line does NOT bleed onto the next line
    // (review finding: over-exemption at the two known-bad ADR-023 sites).
    const inlineAbove = "the MPC gets 0 % <!-- docs-check:ignore stale -->\nand the MPC catches 10 % here";
    expect(sweepBenchClaims("x.md", inlineAbove, CANON)).toHaveLength(1);
  });

  it("prose without a controller-verb-percent shape is not flagged", () => {
    const neutral = [
      "Catch rate: 0 % — the SLS-47 gate is NOT met", // historical metric line (ADR-009 style)
      "versus 50 % for a convex-MPC baseline", // number before controller, no verb
    ].join("\n\n");
    expect(sweepBenchClaims("x.md", neutral, CANON)).toEqual([]);
  });

  it("sweep targets are git-tracked markdown only (no node_modules, no generated files)", () => {
    const targets = sweepTargets(repoRoot);
    expect(targets).toContain("README.md");
    expect(targets.some((t) => t.includes("node_modules"))).toBe(false);
    expect(targets.some((t) => t.startsWith("docs/adr/"))).toBe(true);
  });

  it("the repo is currently drift-free (integration)", () => {
    expect(runAllChecks(repoRoot)).toEqual([]);
  });
});
