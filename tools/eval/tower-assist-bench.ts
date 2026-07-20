/**
 * Active catch-assist benchmark (SLS-82 / ADR-021).
 *
 * Runs the SAME booster-side controller (the deployed RL policy) through the
 * SAME Monte-Carlo protocol as the headline gate, twice per scenario cell:
 *   - `fixed`    — the stationary tower (no assist). This is byte-identical to
 *                  the canonical bench, so its numbers must match the headline.
 *   - `assisted` — a `TrackingTowerController` reaches the chopstick arms toward
 *                  a slightly-off booster, widening the effective envelope.
 *
 * The point is the DELTA: `assisted` should catch more than `fixed` on the same
 * seeds (the arms rescue near-misses) without letting impossible catches
 * through (the arm reach + rate limits are hard-clamped in `stepTowerState`).
 * This bench is deliberately SEPARATE from `pnpm eval:all` so the canonical
 * headline rows + the SLS-66 CI floor keep measuring the fixed tower.
 *
 *   pnpm bench:catch-assist [--seeds 30] [--quick]
 *
 * Output: eval/results/catch-assist-<ts>.json + a comparison table on stdout.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RLController,
  TrackingTowerController,
  runMonteCarlo,
  type MonteCarloResult,
} from "../../packages/controllers/src/index.js";
import type {
  RLPolicyArtifact,
  Scenario,
} from "../../packages/controllers/src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../..");

const SCENARIOS = [
  "booster-descent-calm",
  "booster-descent-standard",
  "booster-descent-stormy",
] as const;

function parseArgs(argv: string[]) {
  const quick = argv.includes("--quick");
  const seedsIdx = argv.indexOf("--seeds");
  const seeds = seedsIdx >= 0 ? Number(argv[seedsIdx + 1]) : quick ? 5 : 30;
  return { seeds };
}

function pct(cell: MonteCarloResult): number {
  return cell.summary.successRate * 100;
}

function main(): void {
  const { seeds } = parseArgs(process.argv.slice(2));
  const artifact = JSON.parse(
    readFileSync(
      join(repo, "apps/web/public/models/booster_policy.json"),
      "utf8",
    ),
  ) as RLPolicyArtifact;

  const rlFactory = (scenario: Scenario) =>
    new RLController(
      scenario.vehicle,
      scenario.targetCatch.targetPosition,
      artifact,
    );

  console.log(`catch-assist bench — RL policy, ${seeds} seeds/cell\n`);
  console.log("scenario   fixed  assisted   delta");
  console.log("--------   -----  --------   -----");

  const cells: Record<string, { fixed: MonteCarloResult; assisted: MonteCarloResult }> =
    {};
  let fixedSum = 0;
  let assistedSum = 0;
  for (const scenarioId of SCENARIOS) {
    const seedList = Array.from({ length: seeds }, (_, i) => i);
    const fixed = runMonteCarlo({
      scenarioId,
      controllerFactory: rlFactory,
      nRuns: seeds,
      seeds: seedList,
    });
    const assisted = runMonteCarlo({
      scenarioId,
      controllerFactory: rlFactory,
      towerControllerFactory: () => new TrackingTowerController(),
      nRuns: seeds,
      seeds: seedList,
    });
    cells[scenarioId] = { fixed, assisted };
    fixedSum += pct(fixed);
    assistedSum += pct(assisted);
    const scen = scenarioId.replace("booster-descent-", "").padEnd(8);
    const d = pct(assisted) - pct(fixed);
    console.log(
      `${scen} ${pct(fixed).toFixed(0).padStart(4)}%  ${pct(assisted)
        .toFixed(0)
        .padStart(6)}%  ${(d >= 0 ? "+" : "") + d.toFixed(0).padStart(4)}pp`,
    );
  }
  const meanFixed = fixedSum / SCENARIOS.length;
  const meanAssisted = assistedSum / SCENARIOS.length;
  console.log(
    `\nmean       ${meanFixed.toFixed(1)}%   ${meanAssisted.toFixed(1)}%   ` +
      `${(meanAssisted - meanFixed >= 0 ? "+" : "") + (meanAssisted - meanFixed).toFixed(1)}pp`,
  );

  mkdirSync(join(repo, "eval/results"), { recursive: true });
  const out = join(repo, `eval/results/catch-assist-${seeds}seeds.json`);
  writeFileSync(
    out,
    JSON.stringify(
      {
        bench: "catch-assist",
        seeds,
        scenarios: SCENARIOS,
        meanFixedPct: meanFixed,
        meanAssistedPct: meanAssisted,
        cells,
      },
      null,
      1,
    ),
  );
  console.log(`\nreport -> ${out}`);
}

main();
