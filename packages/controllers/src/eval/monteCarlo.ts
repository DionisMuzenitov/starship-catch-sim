/**
 * Generic Monte-Carlo evaluator. Takes any `Controller` factory and runs N
 * seeded variants of a chosen scenario against `simStep`, returning per-run
 * outcomes plus an aggregate summary (success rate, median terminal pos
 * error, median fuel use, p99 wall runtime).
 *
 * Shared by the headless `pnpm eval:pid` / `pnpm eval:all` CLIs and the
 * in-CI smoke test that runs 3 seeds per controller to catch regressions.
 * Designed before MPC and RL land so the same harness can drive every
 * controller a future ticket adds without churn.
 *
 * Per-seed IC jitter (Box-Muller on splitmix32) matches the SLS-23 plan:
 * velocity ±5 % per axis, position ±20 m per axis. Optional `environment`
 * scales the scenario's wind field by a multiplier, which the eval sweep
 * uses to plot "success rate vs wind intensity".
 *
 * Wall-clock cap is 600 s of sim time at fixed `dt = 1/250` (the same
 * rate `useSimRunner` uses), with an out-of-relevance bail-out if the
 * vehicle drifts below y = -500 m or beyond 200 km laterally.
 */

import {
  DEFAULT_TOWER_STATE,
  Quat,
  Vec3,
  evaluateCatchOutcome,
  scenarioById,
  simStep,
  stepTowerState,
  type CatchOutcomeKind,
  type Scenario,
  type SimEnv,
  type TerminalMetrics,
  type TowerState,
  type WindField,
  type World,
} from "@starship-catch-sim/physics";

import type { TowerController } from "../towerController.js";
import type { Controller } from "../types.js";

export const PHYSICS_DT = 1 / 250;
export const MAX_SIM_TIME_S = 600;
export const OUT_OF_BOUNDS_Y_M = -500;
export const OUT_OF_BOUNDS_HORIZONTAL_M = 200_000;

export type MonteCarloEnvironment = {
  /** Multiplier applied to the scenario's wind field. 0 = no wind, 1 =
   *  scenario default, 2 = "stormy × 2" for the sweep. */
  windScale: number;
};

export type MonteCarloConfig = {
  scenarioId: string;
  controllerFactory: (scenario: Scenario) => Controller;
  nRuns: number;
  /** If omitted, deterministic seeds `[0, 1, … nRuns-1]` are used. */
  seeds?: readonly number[];
  environment?: MonteCarloEnvironment;
  /** Optional tower-side catch-assist (SLS-82). When present, the arms are
   *  driven live each tick and the catch is evaluated against the moving
   *  capture volume. When ABSENT the tower stays frozen at
   *  `DEFAULT_TOWER_STATE` — the canonical bench, byte-identical to pre-SLS-82,
   *  so the headline catch rates + the SLS-66 floor never move. */
  towerControllerFactory?: (scenario: Scenario) => TowerController;
};

export type RunResult = {
  seed: number;
  caught: boolean;
  outcomeKind: CatchOutcomeKind | "none";
  terminalMetrics: TerminalMetrics;
  /** Sim-time the run terminated at (seconds). */
  durationS: number;
  /** Wall-clock duration of the run (ms). */
  runtimeMs: number;
  /** Fuel mass burned from start to terminal (kg). */
  fuelUsedKg: number;
};

export type MonteCarloSummary = {
  successRate: number;
  medianFinalPosErrM: number;
  medianFuelKg: number;
  p99RuntimeMs: number;
};

export type MonteCarloResult = {
  scenarioId: string;
  windScale: number;
  runs: RunResult[];
  summary: MonteCarloSummary;
};

/**
 * Wrap a `WindField` with a scalar multiplier. Layered + Dryden winds are
 * stateful so we keep the inner reference and just scale the returned
 * vector — never rebuilds the underlying PRNG.
 */
export function scaleWind(field: WindField, k: number): WindField {
  if (k === 1) return field;
  return {
    at(position, time) {
      const w = field.at(position, time);
      return Vec3.of(w.x * k, w.y * k, w.z * k);
    },
  };
}

/**
 * Seeded splitmix32 PRNG → uniform [0, 1). (Shared with monteCarloAsync.)
 */
export function makeRng(seed: number): () => number {
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

/**
 * Box-Muller standard-normal sample. Consumes two uniforms per call.
 * (Shared with monteCarloAsync.)
 */
export function gaussian(rng: () => number): number {
  let u1 = 0;
  let u2 = 0;
  while (u1 === 0) u1 = rng();
  while (u2 === 0) u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Aggregate per-run results. (Shared with monteCarloAsync.) */
export function summarizeRuns(runs: RunResult[]): MonteCarloSummary {
  const caught = runs.filter((r) => r.caught).length;
  return {
    successRate: runs.length === 0 ? 0 : caught / runs.length,
    medianFinalPosErrM: median(
      runs.map((r) => r.terminalMetrics.distanceToTargetM),
    ),
    medianFuelKg: median(runs.map((r) => r.fuelUsedKg)),
    p99RuntimeMs: percentile(
      runs.map((r) => r.runtimeMs),
      0.99,
    ),
  };
}

/** Monotonic-ish wall clock in ms. (Shared with monteCarloAsync.) */
export function nowMs(): number {
  return typeof process !== "undefined" && process.hrtime?.bigint
    ? Number(process.hrtime.bigint()) / 1e6
    : performance.now();
}

/**
 * Per-seed IC jitter — velocity ±5 % per axis, position ±20 m per axis on
 * a seeded PRNG, identical across the sync and async runners so their
 * results are directly comparable.
 */
export function jitterInitialWorld(scenario: Scenario, seed: number): World {
  const rng = makeRng(0x1234_0000 ^ seed);
  const initial = scenario.initialWorld;
  const v0 = initial.rigidBody.velocity;
  const p0 = initial.rigidBody.position;
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
  return {
    ...initial,
    rigidBody: {
      ...initial.rigidBody,
      position: jitterP,
      velocity: jitterV,
    },
  };
}

function runOne(
  scenario: Scenario,
  controller: Controller,
  env: SimEnv,
  seed: number,
  towerController?: TowerController,
): RunResult {
  const startWorld = jitterInitialWorld(scenario, seed);
  const startPropellantKg = startWorld.mass.propellantMass;
  let world = startWorld;
  // Live tower pose. With no assist it stays DEFAULT_TOWER_STATE for every
  // tick, so `evaluateCatchOutcome` sees exactly what it always has.
  let towerState: TowerState = DEFAULT_TOWER_STATE;
  const maxTicks = Math.round(MAX_SIM_TIME_S / PHYSICS_DT);
  let kind: CatchOutcomeKind | "none" = "none";
  let metrics: TerminalMetrics = synthMetrics(world, scenario);
  const startWall = nowMs();
  for (let t = 0; t < maxTicks; t++) {
    const ctl = controller.step(world, PHYSICS_DT);
    world = simStep(world, scenario.vehicle, ctl, PHYSICS_DT, env);
    if (towerController) {
      towerState = stepTowerState(
        towerState,
        towerController.step(world, PHYSICS_DT),
        PHYSICS_DT,
      );
    }
    const outcome = evaluateCatchOutcome(
      world,
      scenario.targetCatch,
      towerState,
    );
    if (outcome.kind !== "none") {
      kind = outcome.kind;
      metrics = outcome.metrics;
      break;
    }
    if (
      world.rigidBody.position.y < OUT_OF_BOUNDS_Y_M ||
      Math.hypot(world.rigidBody.position.x, world.rigidBody.position.z) >
        OUT_OF_BOUNDS_HORIZONTAL_M
    ) {
      kind = "crash";
      metrics = synthMetrics(world, scenario);
      break;
    }
  }
  const runtimeMs = nowMs() - startWall;
  const fuelUsedKg = Math.max(0, startPropellantKg - world.mass.propellantMass);
  if (kind === "none") {
    // Timed out at MAX_SIM_TIME_S without an outcome: report the FINAL
    // world, not the initial one (SLS-48 — initial-state metrics were
    // silently corrupting medianFinalPosErrM).
    metrics = synthMetrics(world, scenario);
  }
  return {
    seed,
    caught: kind === "caught",
    outcomeKind: kind,
    terminalMetrics: metrics,
    durationS: world.t,
    runtimeMs,
    fuelUsedKg,
  };
}

/** Tilt of body +Y from world up, in radians. */
function tiltFromAttitude(world: World): number {
  const up = Quat.rotateVec3(world.rigidBody.attitude, Vec3.of(0, 1, 0));
  return Math.acos(Math.min(1, Math.max(-1, up.y)));
}

/** Terminal metrics for runs that never triggered the catch detector.
 * (Shared with monteCarloAsync.) */
export function synthMetrics(world: World, scenario: Scenario): TerminalMetrics {
  return {
    position: world.rigidBody.position,
    velocity: world.rigidBody.velocity,
    verticalSpeedMps: world.rigidBody.velocity.y,
    horizontalSpeedMps: Math.hypot(
      world.rigidBody.velocity.x,
      world.rigidBody.velocity.z,
    ),
    tiltRad: tiltFromAttitude(world),
    angularRateMagRadPerS: Math.hypot(
      world.rigidBody.angularVelocity.x,
      world.rigidBody.angularVelocity.y,
      world.rigidBody.angularVelocity.z,
    ),
    fuelRemainingKg: world.mass.propellantMass,
    distanceToTargetM: distance(
      world.rigidBody.position,
      scenario.targetCatch.targetPosition,
    ),
  };
}

/**
 * Run `nRuns` seeded variants of `scenarioId` through `controllerFactory`,
 * optionally scaling the scenario's wind field by `environment.windScale`.
 */
export function runMonteCarlo(config: MonteCarloConfig): MonteCarloResult {
  const scenario = scenarioById(config.scenarioId);
  if (!scenario) {
    throw new Error(`runMonteCarlo: unknown scenario ${config.scenarioId}`);
  }
  const windScale = config.environment?.windScale ?? 1;
  const env: SimEnv = {
    ...scenario.env,
    wind: scaleWind(scenario.env.wind, windScale),
  };
  const seeds =
    config.seeds && config.seeds.length > 0
      ? config.seeds
      : Array.from({ length: config.nRuns }, (_, i) => i);
  const runs: RunResult[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const controller = config.controllerFactory(scenario);
    const towerController = config.towerControllerFactory?.(scenario);
    runs.push(runOne(scenario, controller, env, seeds[i]!, towerController));
  }
  return {
    scenarioId: config.scenarioId,
    windScale,
    runs,
    summary: summarizeRuns(runs),
  };
}

/**
 * Wind sweep helper: evaluate the same controller across a range of wind
 * intensities. Useful for "success rate vs wind" plots in the SLS-24
 * writeup.
 */
export function windScaleSweep(
  base: Omit<MonteCarloConfig, "environment">,
  windScales: readonly number[],
): MonteCarloResult[] {
  return windScales.map((windScale) =>
    runMonteCarlo({ ...base, environment: { windScale } }),
  );
}
