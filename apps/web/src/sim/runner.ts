/**
 * Fixed-timestep simulation runner. Owns the active `World`, the
 * controller producing `ControlInput`, a small rewind ring buffer, and
 * the accumulator → physics → render-interpolate loop.
 *
 * Tick budget per the Jira plan (SLS-19 comment):
 *  - physicsDt = 1/250 s (4 ms) — see ticket
 *  - rewind snapshots every 40 ms (25 Hz), 1,500 frames ≈ 60 s
 *  - render-time interpolation: linear lerp for position, slerp for
 *    attitude, snapshot for everything else (engine/surface states are
 *    plant outputs, not visually interpolable)
 *
 * The runner is pure timekeeping + glue; it does NOT own input or
 * controllers (those are injected). That keeps it testable headlessly.
 */

import {
  DEFAULT_TOWER_STATE,
  Quat,
  Vec3,
  evaluateCatchOutcome,
  simStep,
  type CatchEnvelope,
  type CatchOutcome,
  type ControlInput,
  type Recorder,
  type Replay,
  type SimEnv,
  type SiteCollision,
  type TowerState,
  type Vehicle,
  type World,
} from "@starship-catch-sim/physics";
import type { Controller } from "@starship-catch-sim/controllers";

import { drawnSiteCollision } from "./siteCollision";

const PHYSICS_DT = 1 / 250;
const SNAPSHOT_INTERVAL_S = 1 / 25;
const SNAPSHOT_EVERY_N_TICKS = Math.round(SNAPSHOT_INTERVAL_S / PHYSICS_DT);
const RING_BUFFER_SECONDS = 60;
const RING_CAPACITY = Math.round(RING_BUFFER_SECONDS / SNAPSHOT_INTERVAL_S);

export type RunnerCallbacks = {
  /** Called once per advance with the interpolated world for rendering. */
  onRender: (world: World) => void;
  /** Called when pause/scale changes so the UI can reflect it. */
  onMeta?: (meta: { paused: boolean; scale: number }) => void;
  /** Called once when the catch detector reports a non-`none` outcome. */
  onOutcome?: (outcome: CatchOutcome) => void;
  /** Called once when recording finalises (immediately after `onOutcome`). */
  onReplay?: (replay: Replay) => void;
};

export type RunnerArgs = {
  vehicle: Vehicle;
  initialWorld: World;
  controller: Controller;
  callbacks: RunnerCallbacks;
  /** Per-scenario environment (wind + gravity). Optional — defaults
   * to no wind + Earth gravity, matching `simStep`'s own default. */
  env?: SimEnv;
  /** Catch envelope for the active scenario. If omitted, catch detection
   *  is disabled (used by unit tests that don't care about outcomes). */
  catchEnvelope?: CatchEnvelope;
  /** Tower geometry the catch detector evaluates against. Defaults to the
   *  closed-pose, default-height chopstick state. */
  towerState?: TowerState;
  /** Drawn-frame failure collision (ground/tower/OLM). Defaults to the baked
   *  site layout (SLS-79); pass `null` to fall back to physics-frame geometry
   *  (headless benches that don't render the site). */
  siteCollision?: SiteCollision | null;
  /** Replay recorder. If omitted, no replay is captured. */
  recorder?: Recorder;
};

type Snapshot = {
  world: World;
  tickIndex: number;
};

function lerpWorld(prev: World, next: World, alpha: number): World {
  return {
    rigidBody: {
      position: Vec3.lerp(prev.rigidBody.position, next.rigidBody.position, alpha),
      velocity: Vec3.lerp(prev.rigidBody.velocity, next.rigidBody.velocity, alpha),
      attitude: Quat.slerp(prev.rigidBody.attitude, next.rigidBody.attitude, alpha),
      angularVelocity: Vec3.lerp(
        prev.rigidBody.angularVelocity,
        next.rigidBody.angularVelocity,
        alpha,
      ),
      mass: next.rigidBody.mass,
      inertia: next.rigidBody.inertia,
    },
    mass: next.mass,
    engineStates: next.engineStates,
    surfaceStates: next.surfaceStates,
    t: prev.t + (next.t - prev.t) * alpha,
  };
}

export class SimRunner {
  private readonly vehicle: Vehicle;
  private readonly controller: Controller;
  private readonly callbacks: RunnerCallbacks;
  private readonly initial: World;
  private readonly env: SimEnv | undefined;
  private readonly catchEnvelope: CatchEnvelope | undefined;
  private readonly towerState: TowerState;
  private readonly site: SiteCollision | undefined;
  private readonly recorder: Recorder | undefined;
  /** Most recent ControlInput from the controller this tick — captured so
   *  the recorder can pair it with the post-step world. */
  private lastControl: ControlInput | null = null;

  /** State BEFORE the most recent physics step — for render interpolation. */
  private prevWorld: World;
  /** State AFTER the most recent physics step. */
  private world: World;

  private accumulator = 0;
  private tickIndex = 0;
  private paused = true;
  private scale = 1;
  private lastTimeMs: number | null = null;
  private rafId: number | null = null;
  /** Once an outcome fires, the runner stops stepping the world. */
  private ended = false;
  /** Memoised outcome so the callback fires exactly once. */
  private outcome: CatchOutcome | null = null;

  private readonly ring: Snapshot[] = [];

  constructor(args: RunnerArgs) {
    this.vehicle = args.vehicle;
    this.controller = args.controller;
    this.callbacks = args.callbacks;
    this.initial = args.initialWorld;
    this.env = args.env;
    this.catchEnvelope = args.catchEnvelope;
    this.towerState = args.towerState ?? DEFAULT_TOWER_STATE;
    // Default to the baked drawn-site geometry; `null` opts out (physics-frame).
    this.site =
      args.siteCollision === null
        ? undefined
        : (args.siteCollision ?? drawnSiteCollision());
    this.recorder = args.recorder;
    this.prevWorld = args.initialWorld;
    this.world = args.initialWorld;
    this.snapshot();
  }

  start(): void {
    if (this.rafId !== null) return;
    this.lastTimeMs = null;
    const tick = (timeMs: number) => {
      this.frame(timeMs);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.notifyMeta();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.notifyMeta();
  }

  scaleUp(): void {
    this.scale = Math.min(8, this.scale * 2);
    this.notifyMeta();
  }

  scaleDown(): void {
    this.scale = Math.max(1 / 16, this.scale / 2);
    this.notifyMeta();
  }

  reset(): void {
    this.world = this.initial;
    this.prevWorld = this.initial;
    this.accumulator = 0;
    this.tickIndex = 0;
    this.ring.length = 0;
    this.ended = false;
    this.outcome = null;
    this.snapshot();
    this.callbacks.onRender(this.world);
  }

  getOutcome(): CatchOutcome | null {
    return this.outcome;
  }

  rewind(seconds: number): void {
    if (this.ring.length === 0) return;
    const targetTick = this.tickIndex - Math.round(seconds / PHYSICS_DT);
    let pick = this.ring[0]!;
    for (const s of this.ring) {
      if (s.tickIndex <= targetTick) pick = s;
      else break;
    }
    this.world = pick.world;
    this.prevWorld = pick.world;
    this.tickIndex = pick.tickIndex;
    this.accumulator = 0;
    this.callbacks.onRender(this.world);
  }

  /** Step `realDt` worth of sim time forward — exposed for headless tests. */
  advance(realDt: number): void {
    if (this.paused || this.ended) return;
    this.accumulator += realDt * this.scale;
    while (this.accumulator >= PHYSICS_DT) {
      this.physicsTick();
      if (this.ended) {
        this.accumulator = 0;
        break;
      }
      this.accumulator -= PHYSICS_DT;
    }
  }

  /** Snapshot of the latest committed world (without render interpolation). */
  getWorld(): World {
    return this.world;
  }

  getPaused(): boolean {
    return this.paused;
  }

  getScale(): number {
    return this.scale;
  }

  private physicsTick(): void {
    this.prevWorld = this.world;
    const ctl: ControlInput = this.controller.step(this.world, PHYSICS_DT);
    this.lastControl = ctl;
    this.world = simStep(
      this.world,
      this.vehicle,
      ctl,
      PHYSICS_DT,
      this.env,
    );
    this.tickIndex++;
    if (this.tickIndex % SNAPSHOT_EVERY_N_TICKS === 0) this.snapshot();
    // Recorder samples the post-step world paired with the control input
    // that produced it; it owns the cadence downsampling itself.
    this.recorder?.push(this.world.t, this.world, ctl);
    this.checkOutcome();
  }

  private checkOutcome(): void {
    if (this.ended || this.catchEnvelope === undefined) return;
    const outcome = evaluateCatchOutcome(
      this.world,
      this.catchEnvelope,
      this.towerState,
      this.site,
    );
    if (outcome.kind === "none") return;
    this.outcome = outcome;
    this.ended = true;
    if (outcome.kind === "caught") {
      // Pose-lock to the centre of the capture volume so the post-attempt
      // overlay renders the rocket sitting in the chopstick slot.
      const target = this.catchEnvelope.targetPosition;
      this.world = {
        ...this.world,
        rigidBody: {
          ...this.world.rigidBody,
          position: target,
          velocity: Vec3.ZERO,
          angularVelocity: Vec3.ZERO,
        },
      };
      this.prevWorld = this.world;
    }
    this.callbacks.onOutcome?.(outcome);
    if (this.recorder !== undefined) {
      // One final sample at the terminal frame so the replay always ends
      // on the moment the outcome fired.
      this.recorder.push(
        this.world.t,
        this.world,
        this.lastControl ?? this.controller.step(this.world, PHYSICS_DT),
      );
      const replay = this.recorder.finalize(outcome);
      this.callbacks.onReplay?.(replay);
    }
    this.callbacks.onRender(this.world);
  }

  private snapshot(): void {
    if (this.ring.length >= RING_CAPACITY) this.ring.shift();
    this.ring.push({ world: this.world, tickIndex: this.tickIndex });
  }

  private frame(timeMs: number): void {
    if (this.lastTimeMs === null) {
      this.lastTimeMs = timeMs;
      this.callbacks.onRender(this.world);
      return;
    }
    // Spiral-of-death guard: cap the per-frame real dt. This also bounds
    // how far the sim can advance per frame, so below ~1/cap FPS the sim
    // clock lags the ×scale wall rate (slow-motion). Raised from 0.1→0.2
    // (SLS-44) so heavier GLB scenes on weak/headless renderers keep
    // real-time fidelity down to ~5 FPS instead of ~10; the accumulator
    // still substeps at the fixed PHYSICS_DT, so physics stays stable.
    const realDt = Math.min(0.2, (timeMs - this.lastTimeMs) / 1000);
    this.lastTimeMs = timeMs;
    this.advance(realDt);
    const alpha = this.accumulator / PHYSICS_DT;
    const rendered = lerpWorld(this.prevWorld, this.world, alpha);
    this.callbacks.onRender(rendered);
  }

  private notifyMeta(): void {
    this.callbacks.onMeta?.({ paused: this.paused, scale: this.scale });
  }
}

// Re-export the canonical physics dt so consumers (tests, HUD) don't
// hard-code the same constant in two places.
export { PHYSICS_DT };
