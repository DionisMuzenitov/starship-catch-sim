/**
 * SLS-23 — headless Monte-Carlo evaluation of the cascaded PID baseline
 * on `BoosterDescentCalm`. Thin wrapper around the generic SLS-24
 * `runMonteCarlo` harness; printed table + per-seed lines exist so the
 * CLI is still readable when the user re-runs it after a gain tweak.
 *
 *   pnpm eval:pid               # 30 seeds (CLI default)
 *   pnpm eval:pid --seeds=10    # smaller pass
 *
 * Smoke-tested in CI with a 3-seed call via the `evalPidMonteCarlo`
 * export (`packages/controllers/src/pidMonteCarlo.test.ts`).
 */

import {
  DEFAULT_PID_GAINS,
  PIDController,
  runMonteCarlo,
  type MonteCarloResult,
} from "../../packages/controllers/src/index.js";

export type SeedResult = {
  seed: number;
  caught: boolean;
  outcomeKind: string;
  finalY: number;
  finalSpeed: number;
  distanceToTargetM: number;
  durationS: number;
};

export type LegacyMonteCarloResult = {
  seeds: SeedResult[];
  successRate: number;
};

function flatten(mc: MonteCarloResult): LegacyMonteCarloResult {
  return {
    successRate: mc.summary.successRate,
    seeds: mc.runs.map((r) => ({
      seed: r.seed,
      caught: r.caught,
      outcomeKind: r.outcomeKind,
      finalY: r.terminalMetrics.position.y,
      finalSpeed: Math.hypot(
        r.terminalMetrics.verticalSpeedMps,
        r.terminalMetrics.horizontalSpeedMps,
      ),
      distanceToTargetM: r.terminalMetrics.distanceToTargetM,
      durationS: r.durationS,
    })),
  };
}

export function evalPidMonteCarlo(nSeeds: number): LegacyMonteCarloResult {
  const mc = runMonteCarlo({
    scenarioId: "booster-descent-calm",
    nRuns: nSeeds,
    controllerFactory: (scenario) =>
      new PIDController(
        scenario.vehicle,
        scenario.targetCatch.targetPosition,
        () => DEFAULT_PID_GAINS,
      ),
  });
  return flatten(mc);
}

function parseSeedArg(argv: string[]): number {
  const arg = argv.find((a) => a.startsWith("--seeds="));
  if (arg) {
    const n = Number(arg.slice("--seeds=".length));
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 30;
}

function main(): void {
  const nSeeds = parseSeedArg(process.argv.slice(2));
  console.log(`Running ${nSeeds} seeds against BoosterDescentCalm (PID baseline).`);
  const start = process.hrtime.bigint();
  const { seeds, successRate } = evalPidMonteCarlo(nSeeds);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  for (const r of seeds) {
    console.log(
      `  seed ${r.seed.toString().padStart(3, " ")}  ${r.caught ? "✓" : "✗"}  ` +
        `kind=${r.outcomeKind.padEnd(16)}  ` +
        `dist=${r.distanceToTargetM.toFixed(1).padStart(8)} m  ` +
        `final |v|=${r.finalSpeed.toFixed(1).padStart(6)} m/s  ` +
        `dur=${r.durationS.toFixed(1).padStart(5)} s`,
    );
  }
  console.log(
    `\nSuccess: ${(successRate * 100).toFixed(1)} % (${seeds.filter((s) => s.caught).length}/${nSeeds})  ` +
      `Total wall: ${(elapsedMs / 1000).toFixed(2)} s`,
  );
}

const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("pid-monte-carlo.ts");
if (invokedDirectly) main();
