/**
 * SLS-115 diagnostic — is MPC's ±20 m dip caused by degenerate coast-ignition
 * selection (Rank 1)? Runs MPC on calm at two IC widths on the held-out seeds,
 * capturing per run the FIRST committed plan's coast (ignitionTimeS) + burn (tF)
 * + fuel, all accepted plans, and the catch outcome.
 *
 * Rank-1 prediction: ±20 m picks EARLIER ignition (smaller ignitionTimeS) and a
 * LONGER burn (larger tF) than ±50 m, and misses cluster in the earliest tail.
 *
 * Needs the MPC service: `pnpm mpc:serve` in another terminal.
 *   pnpm tsx tools/eval/diag-mpc-ignition.ts --seeds 30
 */
import {
  MPCController,
  acceptanceSeeds,
  dispersedEnv,
  dispersedInitialWorld,
  runMonteCarloAsync,
  type MPCPlan,
  type MPCSolveRequest,
} from "../../packages/controllers/src/index.js";

const URL = "http://localhost:8100";
const SCEN = "booster-descent-calm";
const POS_HORIZ_M = 500; // DISPERSION.posHorizM
const scaleFor = (w: number) => w / POS_HORIZ_M;

const seedsArg = Number(process.argv[process.argv.indexOf("--seeds") + 1]);
const N = Number.isInteger(seedsArg) && seedsArg > 0 ? seedsArg : 30;
const WIDTHS = (process.env.DIAG_WIDTHS ?? "20,50").split(",").map(Number);

async function solve(req: MPCSolveRequest): Promise<unknown> {
  const r = await fetch(`${URL}/solve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!r.ok) throw new Error(`MPC HTTP ${r.status}`);
  return r.json();
}

type Row = {
  width: number;
  seed: number;
  caught: boolean;
  nPlans: number;
  firstIgn: number | null;
  firstTF: number | null;
  firstFuel: number | null;
};

async function runSeed(width: number, seed: number): Promise<Row> {
  const plans: MPCPlan[] = [];
  let inFlight: Promise<unknown> | null = null;
  const r = await runMonteCarloAsync({
    scenarioId: SCEN,
    nRuns: 1,
    seeds: [seed],
    initialWorldFor: (s) => dispersedInitialWorld(s, seed, scaleFor(width)),
    envFor: (s) => dispersedEnv(s, seed),
    controllerFactory: (s) => {
      const c = new MPCController({
        vehicle: s.vehicle,
        targetPosition: s.targetCatch.targetPosition,
        transport: (req: MPCSolveRequest) => {
          const p = solve(req);
          inFlight = p.catch(() => undefined);
          return p;
        },
      });
      c.setPlanObserver((plan) => {
        if (plan) plans.push(plan);
      });
      return c;
    },
    onSimSecond: async () => {
      await inFlight;
      inFlight = null;
    },
  });
  const first = plans[0] ?? null;
  return {
    width,
    seed,
    caught: r.summary.successRate > 0,
    nPlans: plans.length,
    firstIgn: first ? first.ignitionTimeS : null,
    firstTF: first ? first.tF : null,
    firstFuel: first ? first.fuelKg : null,
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

async function main(): Promise<void> {
  if (!(await fetch(`${URL}/health`).then((r) => r.ok).catch(() => false))) {
    console.error(`MPC service unreachable at ${URL} — start it with 'pnpm mpc:serve'.`);
    process.exitCode = 1;
    return;
  }
  const rows: Row[] = [];
  for (const w of WIDTHS) {
    const seeds = acceptanceSeeds(N);
    for (const seed of seeds) {
      const row = await runSeed(w, seed);
      rows.push(row);
      process.stdout.write(
        `  ±${String(w).padStart(3)}m seed ${seed}  ${row.caught ? "CATCH" : "miss "}  ` +
          `ign ${row.firstIgn?.toFixed(1).padStart(5)}s  tF ${row.firstTF?.toFixed(1).padStart(5)}s  plans ${row.nPlans}\n`,
      );
    }
  }

  console.log("\n=== SLS-115 diagnostic summary (calm, first committed plan) ===");
  for (const w of WIDTHS) {
    const sub = rows.filter((r) => r.width === w);
    const ign = sub.map((r) => r.firstIgn).filter((x): x is number => x != null);
    const tF = sub.map((r) => r.firstTF).filter((x): x is number => x != null);
    const caught = sub.filter((r) => r.caught);
    const missed = sub.filter((r) => !r.caught);
    const catchIgn = caught.map((r) => r.firstIgn).filter((x): x is number => x != null);
    const missIgn = missed.map((r) => r.firstIgn).filter((x): x is number => x != null);
    console.log(
      `±${w}m  n=${sub.length}  catch=${((caught.length / sub.length) * 100).toFixed(0)}%  ` +
        `median ign=${median(ign).toFixed(2)}s  median tF=${median(tF).toFixed(2)}s  ` +
        `| median ign of CATCHES=${median(catchIgn).toFixed(2)}s  of MISSES=${median(missIgn).toFixed(2)}s`,
    );
  }
  const stamp = process.env.STAMP ?? "diag";
  const path = `eval/results/diag-mpc-ignition-${N}seed-${stamp}.json`;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(path, JSON.stringify(rows, null, 1));
  console.log(`\n→ wrote ${path}`);
}

void main();
