/**
 * SLS-96 — generate the committed demo catch replays that the static demo
 * links from its "watch a recorded catch" state (MPC needs the local service;
 * a bundled MPC catch shows what the guidance actually does).
 *
 * Replays are produced HEADLESSLY with the SAME single-run loop the eval
 * harness uses (controller.step -> simStep -> evaluateCatchOutcome over
 * jittered seeds), so a committed "MPC catch" is recorded under bench-valid
 * conditions — not a hand-flown one. Frames feed the physics `createRecorder`,
 * whose JSON the browser replay player loads unchanged.
 *
 *   pnpm mpc:serve                                   # for --controller mpc
 *   pnpm tsx tools/eval/gen-demo-replays.ts \
 *     --controller neural --scenario booster-descent-calm \
 *     --out apps/web/public/replays/neural-catch-calm.json
 *
 * It searches seeds until it records a CATCH (so the committed asset is always
 * a clean catch), then stops. Deterministic: same seeds => same replay.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  createRecorder,
  DEFAULT_TOWER_STATE,
  evaluateCatchOutcome,
  scenarioById,
  simStep,
  type CatchOutcome,
  type Replay,
  type Scenario,
  type SimEnv,
  type World,
} from "../../packages/physics/src/index.js";
import {
  MPCController,
  RLController,
  type Controller,
  type MPCSolveRequest,
  type MPCSolveResponse,
  type RLPolicyArtifact,
} from "../../packages/controllers/src/index.js";
import {
  jitterInitialWorld,
  MAX_SIM_TIME_S,
  OUT_OF_BOUNDS_HORIZONTAL_M,
  OUT_OF_BOUNDS_Y_M,
  PHYSICS_DT,
} from "../../packages/controllers/src/eval/monteCarlo.js";

const repo = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const STEPS_PER_SIM_SECOND = Math.round(1 / PHYSICS_DT);
// Recording cadence (Hz); the raw 250 Hz tick is downsampled to this.
const FRAME_RATE_HZ = 25;
// Demo replays keep only the terminal window — the landing burn + catch, the
// part worth watching — and drop the long high-altitude coast. This also keeps
// the committed asset well under the 5 MB blob guard (SLS-65). Playback
// interpolates, so a mid-air start reads fine.
const WINDOW_S = 26;
// Round floats to 6 significant figures before serialising — mm-level for a
// visual replay, ~halves the JSON size. Plain JSON.stringify keeps full f64.
const roundReplacer = (_k: string, v: unknown): unknown =>
  typeof v === "number" && Number.isFinite(v) ? Number(v.toPrecision(6)) : v;

/** Keep only the last WINDOW_S seconds and re-stamp the header duration. */
function trimToTerminal(replay: Replay): Replay {
  const frames = replay.frames;
  if (frames.length === 0) return replay;
  const cutoff = frames[frames.length - 1]!.t - WINDOW_S;
  const kept = frames.filter((f) => f.t >= cutoff);
  const durationS = kept.length > 0 ? kept[kept.length - 1]!.t - kept[0]!.t : 0;
  return { header: { ...replay.header, durationS }, frames: kept };
}

type Args = {
  controller: "neural" | "mpc";
  scenarioId: string;
  seeds: number[];
  url: string;
  out: string;
};

/** Tracks the MPC solve in flight so the sim loop can pause until it lands
 *  (ADR-007's "solver keeps up with the 1 Hz cadence" — same as mpc-bench). */
type SolveTracker = { inFlight: Promise<unknown> | null };

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const controller = (get("--controller") ?? "neural") as "neural" | "mpc";
  const scenarioId = get("--scenario") ?? "booster-descent-calm";
  const seedsRaw = get("--seeds");
  const seeds = seedsRaw
    ? seedsRaw.split(",").map(Number)
    : Array.from({ length: 40 }, (_, i) => i + 1);
  const url = get("--url") ?? "http://localhost:8100";
  const out =
    get("--out") ??
    `apps/web/public/replays/${controller}-catch-${scenarioId}.json`;
  return { controller, scenarioId, seeds, url, out };
}

function makeController(
  kind: "neural" | "mpc",
  scenario: Scenario,
  url: string,
  tracker: SolveTracker,
): Controller {
  if (kind === "neural") {
    const artifact = JSON.parse(
      readFileSync(resolve(repo, "apps/web/public/models/booster_policy.json"), "utf8"),
    ) as RLPolicyArtifact;
    return new RLController(
      scenario.vehicle,
      scenario.targetCatch.targetPosition,
      artifact,
    );
  }
  return new MPCController({
    vehicle: scenario.vehicle,
    targetPosition: scenario.targetCatch.targetPosition,
    transport: (req: MPCSolveRequest): Promise<MPCSolveResponse> => {
      const p = fetch(`${url}/solve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      }).then((resp) => {
        if (!resp.ok) throw new Error(`MPC service HTTP ${resp.status}`);
        return resp.json() as Promise<MPCSolveResponse>;
      });
      tracker.inFlight = p.catch(() => undefined);
      return p;
    },
  });
}

/** Run one seeded descent, recording every tick. Mirrors runOneAsync so the
 *  committed replay is recorded under bench-valid conditions. */
async function recordRun(
  scenario: Scenario,
  controller: Controller,
  env: SimEnv,
  seed: number,
  createdAt: string,
  awaitSolve: () => Promise<unknown>,
): Promise<{ caught: boolean; replay: Replay }> {
  const vehicleId = scenario.id.startsWith("ship") ? "starship" : "super-heavy";
  const rec = createRecorder({
    scenarioId: scenario.id,
    vehicleId,
    seed,
    frameRateHz: FRAME_RATE_HZ,
    createdAt,
  });
  let world: World = jitterInitialWorld(scenario, seed);
  const maxTicks = Math.round(MAX_SIM_TIME_S / PHYSICS_DT);
  let outcome: CatchOutcome | null = null;
  for (let t = 0; t < maxTicks; t++) {
    if (t % STEPS_PER_SIM_SECOND === 0) await awaitSolve();
    const ctl = controller.step(world, PHYSICS_DT);
    world = simStep(world, scenario.vehicle, ctl, PHYSICS_DT, env);
    rec.push(world.t, world, ctl);
    const o = evaluateCatchOutcome(world, scenario.targetCatch, DEFAULT_TOWER_STATE);
    if (o.kind !== "none") {
      outcome = o;
      break;
    }
    if (
      world.rigidBody.position.y < OUT_OF_BOUNDS_Y_M ||
      Math.hypot(world.rigidBody.position.x, world.rigidBody.position.z) >
        OUT_OF_BOUNDS_HORIZONTAL_M
    ) {
      break;
    }
  }
  return { caught: outcome?.kind === "caught", replay: rec.finalize(outcome) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scenario = scenarioById(args.scenarioId);
  if (!scenario) throw new Error(`unknown scenario ${args.scenarioId}`);
  // Fixed timestamp so re-running yields a byte-identical asset (no churn).
  const createdAt = "2026-08-09T00:00:00.000Z";

  if (args.controller === "mpc") {
    const ok = await fetch(`${args.url}/health`).then((r) => r.ok).catch(() => false);
    if (!ok) {
      console.error(`MPC service unreachable at ${args.url} — run 'pnpm mpc:serve' first.`);
      process.exitCode = 1;
      return;
    }
  }

  for (const seed of args.seeds) {
    const tracker: SolveTracker = { inFlight: null };
    const controller = makeController(args.controller, scenario, args.url, tracker);
    const awaitSolve =
      args.controller === "mpc"
        ? async () => {
            await tracker.inFlight;
            tracker.inFlight = null;
          }
        : async () => undefined;
    const { caught, replay } = await recordRun(
      scenario,
      controller,
      scenario.env,
      seed,
      createdAt,
      awaitSolve,
    );
    console.log(`  seed ${seed}: ${caught ? "CATCH" : "miss"}`);
    if (caught) {
      const json = JSON.stringify(trimToTerminal(replay), roundReplacer);
      const outPath = resolve(repo, args.out);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, json);
      const kb = (Buffer.byteLength(json) / 1024).toFixed(0);
      console.log(`\nwrote ${args.out} (${kb} KB, seed ${seed})`);
      return;
    }
  }
  console.error(`No catch found in seeds ${args.seeds.join(",")} — widen --seeds.`);
  process.exitCode = 1;
}

void main();
