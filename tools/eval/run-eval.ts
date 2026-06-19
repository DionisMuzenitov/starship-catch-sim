/**
 * SLS-24 — multi-controller, multi-scenario, wind-sweep Monte-Carlo
 * driver. Reads every controller listed in `CONTROLLERS`, runs it over
 * every (scenarioId, windScale) pair, dumps a single JSON file to
 * `eval/results/<controller>-<timestamp>.json` per controller, and
 * prints a summary table.
 *
 *   pnpm eval:all              # full sweep, all controllers + scenarios
 *   pnpm eval:all --quick      # CI smoke: 3 seeds, calm only, windScale=1
 *
 * The output JSON is the input format for `tools/eval/plot.ts`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEFAULT_PID_GAINS,
  PIDController,
  runMonteCarlo,
  type MonteCarloResult,
} from "../../packages/controllers/src/index.js";
import type { Controller } from "../../packages/controllers/src/types.js";
import type { Scenario } from "../../packages/physics/src/index.js";

const FULL_SCENARIOS = [
  "booster-descent-calm",
  "booster-descent-standard",
  "booster-descent-stormy",
] as const;

const FULL_WIND_SCALES = [0, 0.5, 1, 1.5, 2] as const;
const FULL_SEEDS = 10;

const QUICK_SCENARIOS = ["booster-descent-calm"] as const;
const QUICK_WIND_SCALES = [1] as const;
const QUICK_SEEDS = 3;

type ControllerSpec = {
  key: string;
  label: string;
  factory: (scenario: Scenario) => Controller;
};

const CONTROLLERS: ControllerSpec[] = [
  {
    key: "pid",
    label: "Cascaded PID (default gains)",
    factory: (scenario) =>
      new PIDController(
        scenario.vehicle,
        scenario.targetCatch.targetPosition,
        () => DEFAULT_PID_GAINS,
      ),
  },
];

type EvalRunReport = {
  controllerKey: string;
  controllerLabel: string;
  generatedAt: string;
  seedsPerCell: number;
  cells: MonteCarloResult[];
};

function isoStamp(): string {
  // Date.now() / new Date() are normally banned in workflow scripts but
  // this is a top-level node script (not a Workflow). Format timestamp
  // as YYYY-MM-DDTHH-mm-ss for filesystem-safety.
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function parseFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

export type EvalRunArgs = {
  quick: boolean;
  outDir: string;
  /** Override timestamp for deterministic test runs. */
  stamp?: string;
};

export function runEvalSweep(args: EvalRunArgs): EvalRunReport[] {
  const scenarios = args.quick ? QUICK_SCENARIOS : FULL_SCENARIOS;
  const windScales = args.quick ? QUICK_WIND_SCALES : FULL_WIND_SCALES;
  const seeds = args.quick ? QUICK_SEEDS : FULL_SEEDS;
  mkdirSync(args.outDir, { recursive: true });
  const reports: EvalRunReport[] = [];
  for (const c of CONTROLLERS) {
    const cells: MonteCarloResult[] = [];
    for (const scenarioId of scenarios) {
      for (const windScale of windScales) {
        const cell = runMonteCarlo({
          scenarioId,
          nRuns: seeds,
          environment: { windScale },
          controllerFactory: c.factory,
        });
        cells.push(cell);
      }
    }
    const report: EvalRunReport = {
      controllerKey: c.key,
      controllerLabel: c.label,
      generatedAt: args.stamp ?? isoStamp(),
      seedsPerCell: seeds,
      cells,
    };
    const file = resolve(args.outDir, `${c.key}-${report.generatedAt}.json`);
    writeFileSync(file, JSON.stringify(report, null, 2));
    reports.push(report);
  }
  return reports;
}

function printSummary(reports: EvalRunReport[]): void {
  for (const r of reports) {
    console.log(`\n=== ${r.controllerLabel} (${r.seedsPerCell} seeds/cell) ===`);
    console.log(
      "scenario                       wind   success   medErr m   medFuel kg   p99 ms",
    );
    for (const cell of r.cells) {
      const s = cell.summary;
      console.log(
        `  ${cell.scenarioId.padEnd(28)} ${cell.windScale
          .toFixed(2)
          .padStart(4)}   ${(s.successRate * 100).toFixed(1).padStart(5)} %   ${s.medianFinalPosErrM
          .toFixed(0)
          .padStart(8)}   ${s.medianFuelKg.toFixed(0).padStart(9)}   ${s.p99RuntimeMs
          .toFixed(0)
          .padStart(6)}`,
      );
    }
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const quick = parseFlag(argv, "--quick");
  const outDir = resolve(process.cwd(), "eval/results");
  const startNs = process.hrtime.bigint();
  const reports = runEvalSweep({ quick, outDir });
  const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
  printSummary(reports);
  console.log(
    `\nWrote ${reports.length} report(s) to ${outDir}. Wall ${(elapsedMs / 1000).toFixed(2)} s.`,
  );
}

const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("run-eval.ts");
if (invokedDirectly) main();
