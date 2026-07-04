/**
 * Async Monte-Carlo evaluator (SLS-27) — same contract and IC jitter as
 * `runMonteCarlo`, but the per-step loop yields to the event loop once
 * per sim-second so promise-based controllers (MPCController's HTTP
 * transport) can settle their in-flight requests, and the controller
 * factory itself may be async.
 *
 * The default yield is a macrotask (`setTimeout 0`), which lets pending
 * network I/O complete but does NOT wait for it — the sim clock runs much
 * faster than real time, so an in-flight solve would land several
 * sim-seconds stale. Benches that want "solver keeps up with the re-plan
 * cadence" semantics (the ADR-007 assumption: ~100 ms solve « 1 s cadence)
 * pass `onSimSecond` and await their tracked in-flight request there,
 * pausing sim time until the plan arrives.
 */

import {
  DEFAULT_TOWER_STATE,
  evaluateCatchOutcome,
  scenarioById,
  simStep,
  type CatchOutcomeKind,
  type Scenario,
  type SimEnv,
  type TerminalMetrics,
} from "@starship-catch-sim/physics";

import type { Controller } from "../types.js";
import {
  MAX_SIM_TIME_S,
  OUT_OF_BOUNDS_HORIZONTAL_M,
  OUT_OF_BOUNDS_Y_M,
  PHYSICS_DT,
  jitterInitialWorld,
  nowMs,
  scaleWind,
  summarizeRuns,
  synthMetrics,
  type MonteCarloConfig,
  type MonteCarloResult,
  type RunResult,
} from "./monteCarlo.js";

export type MonteCarloAsyncConfig = Omit<
  MonteCarloConfig,
  "controllerFactory"
> & {
  /** May be async (e.g. warm up a service connection before the run). */
  controllerFactory: (scenario: Scenario) => Controller | Promise<Controller>;
  /**
   * Awaited once per sim-second. Defaults to a macrotask yield; benches
   * can await their in-flight transport promises here (see file header).
   */
  onSimSecond?: () => Promise<unknown>;
};

const yieldMacrotask = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

const STEPS_PER_SIM_SECOND = Math.round(1 / PHYSICS_DT);

async function runOneAsync(
  scenario: Scenario,
  controller: Controller,
  env: SimEnv,
  seed: number,
  onSimSecond: () => Promise<unknown>,
): Promise<RunResult> {
  const startWorld = jitterInitialWorld(scenario, seed);
  const startPropellantKg = startWorld.mass.propellantMass;
  let world = startWorld;
  const maxTicks = Math.round(MAX_SIM_TIME_S / PHYSICS_DT);
  let kind: CatchOutcomeKind | "none" = "none";
  let metrics: TerminalMetrics = synthMetrics(world, scenario);
  const startWall = nowMs();
  for (let t = 0; t < maxTicks; t++) {
    if (t % STEPS_PER_SIM_SECOND === 0) await onSimSecond();
    const ctl = controller.step(world, PHYSICS_DT);
    world = simStep(world, scenario.vehicle, ctl, PHYSICS_DT, env);
    const outcome = evaluateCatchOutcome(
      world,
      scenario.targetCatch,
      DEFAULT_TOWER_STATE,
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
  const fuelUsedKg = Math.max(
    0,
    startPropellantKg - world.mass.propellantMass,
  );
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

/**
 * Async twin of `runMonteCarlo`: seeded runs are executed sequentially
 * (an MPC service solve is CPU-bound server-side, so parallel runs would
 * skew each other's solve-time numbers).
 */
export async function runMonteCarloAsync(
  config: MonteCarloAsyncConfig,
): Promise<MonteCarloResult> {
  const scenario = scenarioById(config.scenarioId);
  if (!scenario) {
    throw new Error(
      `runMonteCarloAsync: unknown scenario ${config.scenarioId}`,
    );
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
  const onSimSecond = config.onSimSecond ?? yieldMacrotask;
  const runs: RunResult[] = [];
  for (const seed of seeds) {
    const controller = await config.controllerFactory(scenario);
    runs.push(await runOneAsync(scenario, controller, env, seed, onSimSecond));
  }
  return {
    scenarioId: config.scenarioId,
    windScale,
    runs,
    summary: summarizeRuns(runs),
  };
}
