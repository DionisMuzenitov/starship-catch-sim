/**
 * v2 dispersion-sensitivity sweep (SLS-93 + SLS-110).
 *
 * The headline v2 deliverable (owner decision 2026-07-26): **catch rate vs.
 * entry-position dispersion width**, for PID / RL / MPC, across calm / standard
 * / stormy. The x-axis is the initial-position σ (±20 → ±400 m, 1σ, within the
 * sim's ~1–2 km fin authority).
 *
 * IMPORTANT — the ±20 m column is NOT the v1 87/87/90 baseline, and must not be
 * read as it. Two things differ from v1 at every width:
 *   1. Per-run wind is fully realized (the frozen-seed-42 fix). v1's windy
 *      numbers were measured against ONE gust sequence; giving the policy a
 *      fresh realization each run drops standard/stormy on its own.
 *   2. The IC also disperses velocity / flight-path-angle / attitude / rates /
 *      propellant, not just position.
 * So the leftmost points are already below 87 % for the windy scenarios — that
 * drop is the *wind-realization* effect, and the slope across widths is the
 * *position-dispersion* effect. The calm row (no wind) isolates the pure
 * position-width curve. The v2 report will state this decomposition explicitly;
 * v1 stays the separate historical record.
 *
 * Usage:
 *   pnpm mpc:serve                          # terminal 1 (only if MPC in scope)
 *   pnpm campaign:v2 --seeds 30             # terminal 2 (overnight)
 *   pnpm campaign:v2 --seeds 50 --controllers pid,rl   # no service needed
 *   pnpm campaign:v2 --seeds 3 --smoke     # fast harness check
 *
 * Flags:
 *   --seeds N          seeds per (controller, scenario, width) cell (default 30)
 *   --widths a,b,c     position-σ widths in metres (default 20,50,100,200,400)
 *   --controllers ...  comma list of pid,rl,mpc (default all)
 *   --url URL          MPC service (default http://localhost:8100)
 *   --smoke            tiny defaults for an end-to-end check
 *
 * Overnight-safe: every cell logs with a timestamp; each controller's full
 * sweep is written as soon as it finishes, so a mid-run failure keeps the
 * completed controllers.
 */

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACCEPTANCE_SEED_BASE,
  DEFAULT_PID_GAINS,
  DISPERSION,
  MPCController,
  PIDController,
  RLController,
  acceptanceSeeds,
  dispersedEnv,
  dispersedInitialWorld,
  runMonteCarlo,
  runMonteCarloAsync,
  type Controller,
  type MonteCarloResult,
  type MPCSolveRequest,
} from "../../packages/controllers/src/index.js";
import type { Scenario } from "../../packages/physics/src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../..");
const DEFAULT_URL = "http://localhost:8100";

const SCENARIOS = [
  "booster-descent-calm",
  "booster-descent-standard",
  "booster-descent-stormy",
] as const;

type Args = {
  seeds: number;
  widthsM: number[];
  url: string;
  controllers: string[];
};

function parseArgs(argv: string[]): Args {
  const val = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const smoke = argv.includes("--smoke");
  const seedsRaw = Number(val("--seeds"));
  const seeds = Number.isInteger(seedsRaw) && seedsRaw > 0 ? seedsRaw : smoke ? 3 : 30;
  // Widths must be strictly > 0: width 0 collapses the dispersion to the exact
  // nominal for every seed, which would report N byte-identical runs as an
  // N-seed measurement.
  const widthsM = (val("--widths") ?? (smoke ? "20,200" : "20,50,100,200,400"))
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (widthsM.length === 0) {
    throw new Error("--widths must list at least one positive width (m)");
  }
  const controllers = (val("--controllers") ?? "pid,rl,mpc")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { seeds, widthsM, url: val("--url") ?? DEFAULT_URL, controllers };
}

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// Resolve the commit once — it can't change mid-run.
const COMMIT: string = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: repo }).toString().trim();
  } catch {
    return "unknown";
  }
})();

/** Position-σ width (m) → the dispersion scale the module multiplies by. */
const scaleFor = (widthM: number): number => widthM / DISPERSION.posHorizM;

type Cell = {
  controller: string;
  scenarioId: string;
  widthM: number;
  scale: number;
  seeds: number;
  catchRate: number;
  medianFinalPosErrM: number;
  medianFuelKg: number;
};

function toCell(
  controller: string,
  scenarioId: string,
  widthM: number,
  seeds: number,
  r: MonteCarloResult,
): Cell {
  return {
    controller,
    scenarioId,
    widthM,
    scale: scaleFor(widthM),
    seeds,
    catchRate: r.summary.successRate,
    medianFinalPosErrM: r.summary.medianFinalPosErrM,
    medianFuelKg: r.summary.medianFuelKg,
  };
}

function logCell(c: Cell): void {
  console.log(
    `  [${ts()}] ${c.controller.padEnd(4)} ${c.scenarioId.replace("booster-descent-", "").padEnd(9)} ` +
      `±${String(c.widthM).padStart(3)} m  catch ${(c.catchRate * 100).toFixed(0).padStart(3)} %  ` +
      `medErr ${c.medianFinalPosErrM.toFixed(0).padStart(5)} m`,
  );
}

function writeSweep(controller: string, cells: Cell[], args: Args): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(
    repo,
    `eval/results/v2-sweep-${controller}-${args.seeds}seed-${stamp}.json`,
  );
  writeFileSync(
    path,
    JSON.stringify(
      {
        controller,
        methodology:
          "v2 dispersion-sensitivity sweep (SLS-110); per-run wind, IC width swept; held-out acceptance seeds (ADR-024)",
        gitCommit: COMMIT,
        generatedAt: stamp,
        seedsPerCell: args.seeds,
        acceptanceSeedBase: ACCEPTANCE_SEED_BASE,
        widthsM: args.widthsM,
        scenarios: SCENARIOS,
        cells,
      },
      null,
      1,
    ),
  );
  console.log(`  → wrote ${path}`);
}

const dispersionHooks = (widthM: number) => ({
  initialWorldFor: (scenario: Scenario, seed: number) =>
    dispersedInitialWorld(scenario, seed, scaleFor(widthM)),
  // Wind is fully per-run at every width (not swept).
  envFor: (scenario: Scenario, seed: number) => dispersedEnv(scenario, seed),
});

// --- sync controllers (PID / RL) ------------------------------------------

function sweepSync(
  controller: string,
  factory: (s: Scenario) => Controller,
  args: Args,
): void {
  console.log(`\n[${ts()}] ${controller} sweep — widths ${args.widthsM.join("/")} m, ${args.seeds} seeds/cell`);
  const cells: Cell[] = [];
  for (const widthM of args.widthsM) {
    for (const scenarioId of SCENARIOS) {
      const r = runMonteCarlo({
        scenarioId,
        controllerFactory: factory,
        nRuns: args.seeds,
        seeds: acceptanceSeeds(args.seeds), // held-out band (ADR-024)
        ...dispersionHooks(widthM),
      });
      const cell = toCell(controller, scenarioId, widthM, args.seeds, r);
      logCell(cell);
      cells.push(cell);
    }
  }
  writeSweep(controller, cells, args);
}

// --- MPC (async, HTTP service, paused clock) ------------------------------

async function sweepMpc(args: Args): Promise<void> {
  console.log(`\n[${ts()}] mpc sweep — widths ${args.widthsM.join("/")} m, ${args.seeds} seeds/cell (paused clock)`);
  const cells: Cell[] = [];
  for (const widthM of args.widthsM) {
    for (const scenarioId of SCENARIOS) {
      let inFlight: Promise<unknown> | null = null;
      const r = await runMonteCarloAsync({
        scenarioId,
        nRuns: args.seeds,
        seeds: acceptanceSeeds(args.seeds), // held-out band (ADR-024)
        ...dispersionHooks(widthM),
        controllerFactory: (s) =>
          new MPCController({
            vehicle: s.vehicle,
            targetPosition: s.targetCatch.targetPosition,
            transport: (req: MPCSolveRequest) => {
              const p = solveMpc(args.url, req);
              inFlight = p.catch(() => undefined);
              return p;
            },
          }),
        onSimSecond: async () => {
          await inFlight;
          inFlight = null;
        },
      });
      const cell = toCell("mpc", scenarioId, widthM, args.seeds, r);
      logCell(cell);
      cells.push(cell);
    }
  }
  writeSweep("mpc", cells, args);
}

async function solveMpc(url: string, req: MPCSolveRequest): Promise<unknown> {
  const resp = await fetch(`${url}/solve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!resp.ok) throw new Error(`MPC service HTTP ${resp.status}`);
  return resp.json();
}

async function checkHealth(url: string): Promise<boolean> {
  try {
    return (await fetch(`${url}/health`, { signal: AbortSignal.timeout(2_000) })).ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(join(repo, "eval/results"), { recursive: true });
  console.log(
    `v2 dispersion-sensitivity sweep (SLS-93/110)\n` +
      `  widths (±m, 1σ pos): ${args.widthsM.join(", ")}   seeds/cell: ${args.seeds}\n` +
      `  controllers: ${args.controllers.join(", ")}   commit: ${COMMIT}   started: ${ts()}`,
  );

  if (args.controllers.includes("pid")) {
    sweepSync(
      "pid",
      (s) => new PIDController(s.vehicle, s.targetCatch.targetPosition, () => DEFAULT_PID_GAINS),
      args,
    );
  }
  if (args.controllers.includes("rl")) {
    const artifact = JSON.parse(
      readFileSync(join(repo, "apps/web/public/models/booster_policy.json"), "utf8"),
    );
    sweepSync(
      "rl",
      (s) => new RLController(s.vehicle, s.targetCatch.targetPosition, artifact as never),
      args,
    );
  }
  if (args.controllers.includes("mpc")) {
    if (!(await checkHealth(args.url))) {
      console.error(
        `\nMPC service unreachable at ${args.url}. Start it: pnpm mpc:serve\n` +
          `(Any PID/RL sweeps above were still written.)`,
      );
      process.exitCode = 1;
      return;
    }
    await sweepMpc(args);
  }

  console.log(`\n[${ts()}] sweep complete. Records in eval/results/v2-sweep-*.json`);
}

void main();
