/**
 * The controller-generation registry — the ONE list of shipped generations and
 * the committed gate-record file that backs each one's headline number.
 *
 * Consumed by:
 *  - `tools/eval/progression-chart.ts` (SLS-72) — the north-star chart
 *  - `tools/docs-check.ts` (SLS-107) — the docs-freshness CI guard
 *
 * When a new milestone gate lands a gate-record, append ONE entry here: the
 * chart gains its bar group and docs-check automatically starts verifying the
 * new generation's README results row and prose claims. (Previously the chart
 * and the docs guard each hard-coded this list — drift between them meant the
 * newest headline number was exactly the one nothing verified.)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Scenario = "calm" | "standard" | "stormy";
export const SCENARIOS: Scenario[] = ["calm", "standard", "stormy"];

export interface Generation {
  /** Chart bar-group label; also a prose token docs-check matches. */
  label: string;
  milestone: string;
  /** committed gate-record file holding this generation's winning bench */
  file: string;
  /** Other names docs prose uses for this controller ("Cascaded PID", "the
   *  policy", …) — docs-check matches claims under any of these too. */
  aliases: string[];
}

// One entry per controller generation, oldest -> newest. Append a row when a
// new milestone gate lands its gate-record.
// Numbers are the v2 acceptance baseline (SLS-93/97): the held-out,
// domain-randomized benchmark at the ±20 m entry-corridor reference width.
// The earlier fixed-wind milestone-gate records (m5/m6-*) are retained in
// gate-records for provenance and the v0.5/v0.6 releases, but are no longer the
// canonical headline — see the MANIFEST.
export const GENERATIONS: Generation[] = [
  {
    label: "PID",
    milestone: "M4",
    file: "v2-acceptance-pid.json",
    aliases: ["Cascaded PID"],
  },
  {
    label: "MPC",
    milestone: "M5",
    file: "v2-acceptance-mpc.json",
    aliases: ["Convex MPC"],
  },
  {
    label: "Neural policy",
    milestone: "M6",
    file: "v2-acceptance-rl.json",
    aliases: ["neural policy", "the policy", "RL"],
  },
];

export interface GateCell {
  scenarioId: string;
  windScale: number;
  summary: { successRate: number };
}

/** Gate records come in two shapes: a `{...meta, cells}` object (mpc-bench)
 *  or a bare cell array (rl-bench). Normalise to the cell list. */
export function loadGateCells(gateDir: string, file: string): GateCell[] {
  const raw = JSON.parse(readFileSync(join(gateDir, file), "utf8")) as
    | GateCell[]
    | { cells: GateCell[] };
  return Array.isArray(raw) ? raw : raw.cells;
}

/** Map a generation's cells to a {calm,standard,stormy} success-rate record.
 *  Prefer the scenarioId suffix; when every cell shares one scenarioId (the
 *  M5 bench varies wind by windScale, not id) fall back to windScale
 *  0/1/2 -> calm/standard/stormy. Never trusts the JSON's emission order. */
export function ratesByScenario(cells: GateCell[]): Record<Scenario, number> {
  const uniqueIds = new Set(cells.map((c) => c.scenarioId));
  const out = {} as Record<Scenario, number>;
  const byWind: Record<number, Scenario> = {
    0: "calm",
    1: "standard",
    2: "stormy",
  };
  for (const c of cells) {
    let scen: Scenario | undefined;
    if (uniqueIds.size > 1) {
      scen = SCENARIOS.find((s) => c.scenarioId.endsWith(s));
    } else {
      scen = byWind[c.windScale];
    }
    if (!scen)
      throw new Error(`cannot bucket cell ${c.scenarioId}/${c.windScale}`);
    out[scen] = c.summary.successRate;
  }
  for (const s of SCENARIOS) {
    if (out[s] === undefined) throw new Error(`missing scenario ${s}`);
  }
  return out;
}
