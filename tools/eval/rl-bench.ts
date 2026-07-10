/**
 * RL-vs-PID benchmark on the TS physics core (SLS-30).
 *
 * Runs the imitation-learned neural policy (RLController, pure-TS forward
 * pass — no service, no WASM) and the PID baseline through the same
 * Monte Carlo protocol as the M5 MPC gate: the three booster scenarios
 * (calm / standard / stormy wind), N seeded runs with jittered initial
 * worlds.
 * MPC numbers are NOT re-run here (they need the Python service); the
 * report cites the recorded SLS-47 gate results.
 *
 *   pnpm bench:rl [--seeds 30] [--quick]
 *
 * Output: eval/results/rl-bench-{rl,pid}-<ts>.json (same shape as
 * run-eval.ts, so `pnpm plot` can consume them) + a summary table on
 * stdout + eval/plots/rl-bench-success.svg.
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PID_GAINS,
  PIDController,
  RLController,
  type Controller,
  type RLPolicyArtifact,
  runMonteCarlo,
  type MonteCarloResult,
} from "../../packages/controllers/src/index.js";
import type { Scenario } from "../../packages/physics/src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../..");

/** Short commit the benchmark ran against — stamps each record so a gate
 *  result is self-describing (SLS-67). "unknown" outside a git checkout. */
function gitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: repo })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

function parseArgs(argv: string[]) {
  const quick = argv.includes("--quick");
  const seedsIdx = argv.indexOf("--seeds");
  const seeds =
    seedsIdx >= 0 ? Number(argv[seedsIdx + 1]) : quick ? 3 : 30;
  return { quick, seeds };
}

function logCell(label: string, scenarioId: string, cell: MonteCarloResult) {
  const s = cell.summary;
  const scen = scenarioId.replace("booster-descent-", "");
  console.log(
    `${label.padEnd(4)} ${scen.padEnd(9)} success ${(s.successRate * 100).toFixed(0).padStart(3)}%  ` +
      `medPosErr ${s.medianFinalPosErrM.toFixed(1)} m  medFuel ${(s.medianFuelKg / 1000).toFixed(1)} t`,
  );
}

function successSvg(
  rows: { label: string; byScenario: Map<string, number> }[],
  scenarios: readonly string[],
): string {
  const w = 460;
  const h = 260;
  const x0 = 50;
  const y0 = 210;
  const dx = (w - x0 - 30) / Math.max(1, scenarios.length - 1);
  const colors = ["#e4572e", "#4c9f70"];
  let body = "";
  rows.forEach((row, ri) => {
    const pts = scenarios
      .map(
        (sc, i) =>
          `${x0 + i * dx},${y0 - (row.byScenario.get(sc) ?? 0) * 160}`,
      )
      .join(" ");
    body += `<polyline fill="none" stroke="${colors[ri % 2]}" stroke-width="2.5" points="${pts}"/>`;
    body += `<text x="${w - 90}" y="${30 + ri * 18}" fill="${colors[ri % 2]}" font-size="13">${row.label}</text>`;
  });
  const ticks = scenarios
    .map(
      (sc, i) =>
        `<text x="${x0 + i * dx}" y="${y0 + 22}" text-anchor="middle" font-size="12" fill="#555">${sc.replace("booster-descent-", "")}</text>`,
    )
    .join("");
  const yTicks = [0, 0.5, 1]
    .map(
      (f) =>
        `<text x="${x0 - 8}" y="${y0 - f * 160 + 4}" text-anchor="end" font-size="12" fill="#555">${f * 100}%</text>`,
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" font-family="system-ui">` +
    `<text x="${x0}" y="20" font-size="14" fill="#222">Catch success by scenario (TS bench, wind 1x)</text>` +
    body +
    ticks +
    yTicks +
    `</svg>`
  );
}

const SCENARIOS = [
  "booster-descent-calm",
  "booster-descent-standard",
  "booster-descent-stormy",
] as const;

function main() {
  const { seeds } = parseArgs(process.argv.slice(2));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync(join(repo, "eval/results"), { recursive: true });
  mkdirSync(join(repo, "eval/plots"), { recursive: true });

  const artifact = JSON.parse(
    readFileSync(
      join(repo, "apps/web/public/models/booster_policy.json"),
      "utf8",
    ),
  ) as RLPolicyArtifact;

  const rows: { label: string; byScenario: Map<string, number> }[] = [];
  const allCells: Record<string, MonteCarloResult[]> = { rl: [], pid: [] };

  const factories: Record<string, (scenario: Scenario) => Controller> = {
    rl: (scenario) =>
      new RLController(
        scenario.vehicle,
        scenario.targetCatch.targetPosition,
        artifact,
      ),
    pid: (scenario) =>
      new PIDController(
        scenario.vehicle,
        scenario.targetCatch.targetPosition,
        () => DEFAULT_PID_GAINS,
      ),
  };
  for (const [label, factory] of Object.entries(factories)) {
    const byScenario = new Map<string, number>();
    for (const scenarioId of SCENARIOS) {
      const cell = runMonteCarlo({
        scenarioId,
        controllerFactory: factory,
        nRuns: seeds,
        environment: { windScale: 1 },
      });
      logCell(label, scenarioId, cell);
      byScenario.set(scenarioId, cell.summary.successRate);
      allCells[label].push(cell);
    }
    rows.push({ label, byScenario });
    writeFileSync(
      join(repo, `eval/results/rl-bench-${label}-${stamp}.json`),
      JSON.stringify(
        {
          controllerKey: label,
          gitCommit: gitCommit(),
          generatedAt: stamp,
          seeds,
          scenarios: SCENARIOS,
          cells: allCells[label],
        },
        null,
        1,
      ),
    );
  }

  writeFileSync(
    join(repo, "eval/plots/rl-bench-success.svg"),
    successSvg(rows, SCENARIOS),
  );
  console.log("\nreports -> eval/results/, plot -> eval/plots/rl-bench-success.svg");
}

main();
