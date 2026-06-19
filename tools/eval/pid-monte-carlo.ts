/**
 * SLS-23 — headless Monte-Carlo evaluation of the cascaded PID baseline.
 *
 * Runs the BoosterDescentCalm scenario N times with seeded IC jitter
 * (Box-Muller perturbations on initial velocity ±5 % and position ±20 m),
 * driving the PID controller from `packages/controllers` directly against
 * `simStep`. No web runtime; no rendering. Prints per-seed outcomes and
 * the aggregate catch rate.
 *
 *   pnpm eval:pid               # 30 seeds (CLI default)
 *   pnpm eval:pid --seeds=10    # smaller pass
 *
 * Used as the headless reference for the SLS-23 acceptance criterion
 * ("≥ 50 % catch in 30 seeds on Calm"). Smoke-tested in CI with a 3-seed
 * call via the `evalPidMonteCarlo` export.
 */

import {
  BoosterDescentCalm,
  Vec3,
  evaluateCatchOutcome,
  DEFAULT_TOWER_STATE,
  simStep,
} from "../../packages/physics/src/index.js";
import { DEFAULT_PID_GAINS, PIDController } from "../../packages/controllers/src/index.js";

const PHYSICS_DT = 1 / 250;
const MAX_SIM_TIME_S = 600;

/**
 * Seeded splitmix32 PRNG → uniform [0,1). Wrapped Box-Muller below.
 */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = ((z ^ (z >>> 16)) * 0x85ebca6b) >>> 0;
    z = ((z ^ (z >>> 13)) * 0xc2b2ae35) >>> 0;
    z = (z ^ (z >>> 16)) >>> 0;
    return z / 0x1_0000_0000;
  };
}

function gaussian(rng: () => number): number {
  // Box-Muller. Two uniforms → one standard-normal sample. We discard the
  // second to keep the call signature simple.
  let u1 = 0;
  let u2 = 0;
  while (u1 === 0) u1 = rng();
  while (u2 === 0) u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export type SeedResult = {
  seed: number;
  caught: boolean;
  outcomeKind: string;
  finalY: number;
  finalSpeed: number;
  distanceToTargetM: number;
  durationS: number;
};

export type MonteCarloResult = {
  seeds: SeedResult[];
  successRate: number;
};

/**
 * Run `nSeeds` instances of the BoosterDescentCalm scenario through the
 * cascaded PID, applying seeded IC jitter per the SLS-23 plan.
 */
export function evalPidMonteCarlo(nSeeds: number): MonteCarloResult {
  const results: SeedResult[] = [];
  for (let i = 0; i < nSeeds; i++) {
    const rng = makeRng(0x1234_0000 ^ i);
    const initial = BoosterDescentCalm.initialWorld;
    const v0 = initial.rigidBody.velocity;
    const p0 = initial.rigidBody.position;
    // ±5 % velocity, ±20 m position perturbation per axis.
    const jitterV = Vec3.of(
      v0.x * (1 + 0.05 * gaussian(rng)),
      v0.y * (1 + 0.05 * gaussian(rng)),
      v0.z * (1 + 0.05 * gaussian(rng)),
    );
    const jitterP = Vec3.of(
      p0.x + 20 * gaussian(rng),
      p0.y + 20 * gaussian(rng),
      p0.z + 20 * gaussian(rng),
    );
    const startWorld = {
      ...initial,
      rigidBody: {
        ...initial.rigidBody,
        position: jitterP,
        velocity: jitterV,
      },
    };
    const pid = new PIDController(
      BoosterDescentCalm.vehicle,
      BoosterDescentCalm.targetCatch.targetPosition,
      () => DEFAULT_PID_GAINS,
    );
    let world = startWorld;
    const maxTicks = Math.round(MAX_SIM_TIME_S / PHYSICS_DT);
    let kind = "none";
    let metrics = {
      position: world.rigidBody.position,
      verticalSpeedMps: world.rigidBody.velocity.y,
      horizontalSpeedMps: Math.hypot(
        world.rigidBody.velocity.x,
        world.rigidBody.velocity.z,
      ),
      distanceToTargetM: 0,
    };
    for (let t = 0; t < maxTicks; t++) {
      const ctl = pid.step(world, PHYSICS_DT);
      world = simStep(
        world,
        BoosterDescentCalm.vehicle,
        ctl,
        PHYSICS_DT,
        BoosterDescentCalm.env,
      );
      const outcome = evaluateCatchOutcome(
        world,
        BoosterDescentCalm.targetCatch,
        DEFAULT_TOWER_STATE,
      );
      if (outcome.kind !== "none") {
        kind = outcome.kind;
        metrics = {
          position: outcome.metrics.position,
          verticalSpeedMps: outcome.metrics.verticalSpeedMps,
          horizontalSpeedMps: outcome.metrics.horizontalSpeedMps,
          distanceToTargetM: outcome.metrics.distanceToTargetM,
        };
        break;
      }
      // Bail-out if we've drifted out of relevance.
      if (
        world.rigidBody.position.y < -500 ||
        Math.hypot(world.rigidBody.position.x, world.rigidBody.position.z) > 200_000
      ) {
        kind = "crash";
        metrics = {
          position: world.rigidBody.position,
          verticalSpeedMps: world.rigidBody.velocity.y,
          horizontalSpeedMps: Math.hypot(
            world.rigidBody.velocity.x,
            world.rigidBody.velocity.z,
          ),
          distanceToTargetM: Math.hypot(
            world.rigidBody.position.x -
              BoosterDescentCalm.targetCatch.targetPosition.x,
            world.rigidBody.position.y -
              BoosterDescentCalm.targetCatch.targetPosition.y,
            world.rigidBody.position.z -
              BoosterDescentCalm.targetCatch.targetPosition.z,
          ),
        };
        break;
      }
    }
    results.push({
      seed: i,
      caught: kind === "caught",
      outcomeKind: kind,
      finalY: metrics.position.y,
      finalSpeed: Math.hypot(
        metrics.verticalSpeedMps,
        metrics.horizontalSpeedMps,
      ),
      distanceToTargetM: metrics.distanceToTargetM,
      durationS: world.t,
    });
  }
  const caughtCount = results.filter((r) => r.caught).length;
  return { seeds: results, successRate: caughtCount / nSeeds };
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

// Run only when invoked directly via `tsx tools/eval/pid-monte-carlo.ts`.
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("pid-monte-carlo.ts");
if (invokedDirectly) main();
