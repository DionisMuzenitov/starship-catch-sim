/**
 * MPC guidance client (SLS-26, ADR-007).
 *
 * Wraps the Python SOCP service: fires a re-plan request at a fixed
 * cadence (default 1 Hz per ADR-007), caches the most recent plan, and
 * tracks it between plans with feedforward thrust-acceleration plus a PD
 * position/velocity correction feeding the same attitude-PID inner loop
 * the baseline controller uses. Falls back to the cascaded PID outright
 * when no usable plan exists (service down, solver infeasible, or plan
 * expired).
 *
 * `step()` is synchronous (Controller contract) while HTTP is async, so
 * the transport is fire-and-forget: a completed response becomes
 * `this.plan` and is consumed on subsequent steps. Tests inject a fake
 * `solve` transport — no service required.
 */

import {
  Quat,
  Vec3,
  neutralControl,
  type ControlInput,
  type EngineGroupBag,
  type Vehicle,
  type World,
} from "@starship-catch-sim/physics";

import { PID } from "./pid.js";
import {
  DEFAULT_PID_GAINS,
  PIDController,
  type PIDControllerGains,
} from "./pidController.js";
import type { Controller } from "./types.js";

// ---------------------------------------------------------------------------
// Service wire types (mirror services/mpc/src/mpc/server.py).
// ---------------------------------------------------------------------------

export type MPCSolveRequest = {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  massKg: number;
  vehicle: {
    dryMassKg: number;
    maxThrustN: number;
    minThrustN: number;
    ispS: number;
  };
  tFHintS?: number;
  /**
   * "scvx" makes the service iterate drag relinearization (SLS-27) —
   * zero-drag "linear" plans through the transonic regime are unflyable
   * (the SLS-27 bench measured 55 km terminal error tracking them).
   */
  mode?: "linear" | "scvx";
};

export type MPCSolveResponse = {
  status: string;
  tFS: number;
  solveTimeMs: number;
  fuelKg: number;
  terminalSlack: number;
  predictedPositions: { x: number; y: number; z: number }[];
  predictedVelocities: { x: number; y: number; z: number }[];
  thrustAccel: { x: number; y: number; z: number }[];
  throttle: number[];
};

export type MPCTransport = (req: MPCSolveRequest) => Promise<MPCSolveResponse>;

/** Plan as consumed by the tracker: world-time-anchored arrays. */
export type MPCPlan = {
  /** World sim time when the plan's node 0 applies. */
  t0: number;
  tF: number;
  dtNode: number;
  positions: Vec3[];
  velocities: Vec3[];
  thrustAccel: Vec3[];
  solveTimeMs: number;
  fuelKg: number;
};

export type MPCPlanObserver = (plan: MPCPlan | null) => void;

export type MPCControllerOpts = {
  vehicle: Vehicle;
  targetPosition: Vec3;
  /** Injectable transport; default POSTs to `serviceUrl`. */
  transport?: MPCTransport;
  serviceUrl?: string;
  /** Re-plan cadence in sim seconds (ADR-007 baseline: 1 Hz). */
  replanIntervalS?: number;
  /** Gains for the PID fallback + shared attitude inner loop. */
  gainsRef?: () => PIDControllerGains;
};

const DEFAULT_SERVICE_URL = "http://localhost:8100";

/**
 * Plans whose soft terminal box needed more slack than this are not real
 * descent solutions — the service's always-feasible relaxation reports
 * `optimal` even when the target is unreachable (e.g. high-altitude ICs
 * where the thrust floor forbids a full-horizon burn), soaking the miss
 * into the slack variables. Tracking such a plan burns fuel flying to
 * nowhere; the PID fallback is strictly better until a low-slack plan
 * appears in the terminal window.
 */
const MAX_USABLE_TERMINAL_SLACK = 5;

/**
 * Drop a plan that hasn't been superseded within this many seconds. A
 * stale plan means every re-plan since has failed or been rejected — the
 * world has drifted from what the plan assumed, and the PID fallback is
 * safer than tracking a fiction.
 */
const STALE_PLAN_MAX_S = 10;

/** Tracking-correction gains (on top of plan feedforward). */
const TRACK_KP = 0.05;
const TRACK_KD = 0.3;

/**
 * Cap on the PD correction magnitude (m/s²). Divergence beyond what this
 * trims is the 1 Hz re-plan's job — an unclamped correction on a few
 * hundred metres of error demands tens of m/s², saturates the whole
 * stack, swings the attitude and locks into a full-burn instability
 * (SLS-27 bench: tank drained in 18 s, 55 km terminal error).
 */
const TRACK_CORRECTION_MAX = 3;

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

function fetchTransport(serviceUrl: string): MPCTransport {
  return async (req) => {
    const resp = await fetch(`${serviceUrl}/solve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!resp.ok) throw new Error(`MPC service HTTP ${resp.status}`);
    return (await resp.json()) as MPCSolveResponse;
  };
}

export class MPCController implements Controller {
  private readonly finCount: number;
  private readonly flapCount: number;
  private readonly transport: MPCTransport;
  private readonly replanIntervalS: number;
  private readonly gainsRef: () => PIDControllerGains;
  private readonly fallback: PIDController;
  private readonly attPidPitch: PID;
  private readonly attPidYaw: PID;
  private readonly maxThrustN: number;
  private readonly minThrustN: number;
  private readonly fullStackThrustN: number;
  private readonly ispS: number;

  private plan: MPCPlan | null = null;
  private lastRequestT = -Infinity;
  private inFlight = false;
  private observer: MPCPlanObserver | null = null;
  /** Exposed for the HUD: true while the PID fallback is steering. */
  private usingFallback = true;

  constructor(opts: MPCControllerOpts) {
    this.finCount = opts.vehicle.surfaces.filter(
      (s) => s.kind === "grid_fin",
    ).length;
    this.flapCount = opts.vehicle.surfaces.filter(
      (s) => s.kind === "flap",
    ).length;
    this.transport =
      opts.transport ?? fetchTransport(opts.serviceUrl ?? DEFAULT_SERVICE_URL);
    this.replanIntervalS = opts.replanIntervalS ?? 1.0;
    this.gainsRef = opts.gainsRef ?? (() => DEFAULT_PID_GAINS);
    this.fallback = new PIDController(
      opts.vehicle,
      opts.targetPosition,
      this.gainsRef,
    );
    const g = this.gainsRef();
    this.attPidPitch = new PID(g.attitudePitch);
    this.attPidYaw = new PID(g.attitudeYaw);

    // Thrust envelope for the SOCP: the 13-engine landing set (centre 3 +
    // inner 10) at sea-level thrust for the max, the gimbal-capable centre
    // engines at the throttle floor for the min. Falls back gracefully for
    // vehicles with fewer engines (the ship).
    const engines = opts.vehicle.engines;
    const landingCount = Math.min(13, engines.length);
    const gimballed = engines.filter((e) => e.canGimbal);
    const minSet = gimballed.length > 0 ? gimballed.slice(0, 3) : engines;
    this.maxThrustN = engines
      .slice(0, landingCount)
      .reduce((s, e) => s + e.thrustSea, 0);
    this.fullStackThrustN = engines.reduce((s, e) => s + e.thrustSea, 0);
    this.minThrustN = minSet.reduce(
      (s, e) => s + e.minThrottle * e.thrustSea,
      0,
    );
    this.ispS =
      engines.reduce((s, e) => s + e.ispSea, 0) / Math.max(engines.length, 1);
  }

  setPlanObserver(observer: MPCPlanObserver | null): void {
    this.observer = observer;
  }

  isUsingFallback(): boolean {
    return this.usingFallback;
  }

  getPlan(): MPCPlan | null {
    return this.plan;
  }

  reset(): void {
    this.plan = null;
    this.lastRequestT = -Infinity;
    this.usingFallback = true;
    this.fallback.reset();
    this.attPidPitch.reset();
    this.attPidYaw.reset();
    this.observer?.(null);
  }

  step(world: World, dt: number): ControlInput {
    this.maybeRequestPlan(world);

    const plan = this.plan;
    const tInPlan = plan === null ? Infinity : world.t - plan.t0;
    if (
      plan === null ||
      tInPlan < 0 ||
      tInPlan >= plan.tF ||
      tInPlan > STALE_PLAN_MAX_S
    ) {
      this.usingFallback = true;
      return this.fallback.step(world, dt);
    }
    this.usingFallback = false;

    // --- Plan lookup (zero-order hold on controls, lerp on states). ---
    const kf = tInPlan / plan.dtNode;
    const k = Math.min(Math.floor(kf), plan.thrustAccel.length - 1);
    const frac = clamp(kf - k, 0, 1);
    const rStar = Vec3.lerp(
      plan.positions[k]!,
      plan.positions[Math.min(k + 1, plan.positions.length - 1)]!,
      frac,
    );
    const vStar = Vec3.lerp(
      plan.velocities[k]!,
      plan.velocities[Math.min(k + 1, plan.velocities.length - 1)]!,
      frac,
    );
    const uStar = plan.thrustAccel[k]!;

    // --- Feedforward + PD tracking correction → commanded thrust accel ---
    const pos = world.rigidBody.position;
    const vel = world.rigidBody.velocity;
    let correction = Vec3.add(
      Vec3.scale(Vec3.sub(rStar, pos), TRACK_KP),
      Vec3.scale(Vec3.sub(vStar, vel), TRACK_KD),
    );
    const corrMag = Vec3.length(correction);
    if (corrMag > TRACK_CORRECTION_MAX) {
      correction = Vec3.scale(correction, TRACK_CORRECTION_MAX / corrMag);
    }
    const aCmd = Vec3.add(uStar, correction);

    // --- Convert to throttle + attitude setpoints ---
    const g = this.gainsRef();
    this.attPidPitch.gains = g.attitudePitch;
    this.attPidYaw.gains = g.attitudeYaw;

    const aMag = Vec3.length(aCmd);
    const m = world.rigidBody.mass;
    // Desired TOTAL thrust as a fraction of the full 33-engine stack, then
    // inverted through the activation ladder. Scaling against the
    // 13-engine SOCP envelope here would be a unit mismatch: the ladder
    // maps cmd=1 to the whole stack, so plans demanding the SOCP max
    // would light 2.5× the intended thrust (SLS-27 bench regression:
    // full-stack burn drained the tank in 18 s).
    const thrustFraction = clamp((aMag * m) / this.fullStackThrustN, 0, 1);
    const throttle = this.allocateThrottle(
      this.ladderCmdForThrustFraction(thrustFraction),
    );
    const enginesOn: EngineGroupBag<boolean> = {
      centre: throttle.centre > 0,
      inner: throttle.inner > 0,
      outer: throttle.outer > 0,
      ship: false,
    };

    // Tilt setpoints: desired thrust direction's horizontal components.
    const dir = aMag > 1e-6 ? Vec3.scale(aCmd, 1 / aMag) : Vec3.of(0, 1, 0);
    const tiltSetpointX = clamp(dir.x, -g.maxTiltRad, g.maxTiltRad);
    const tiltSetpointZ = clamp(dir.z, -g.maxTiltRad, g.maxTiltRad);

    const bodyUpWorld = Quat.rotateVec3(
      world.rigidBody.attitude,
      Vec3.of(0, 1, 0),
    );
    const gimbalPitch = clamp(
      this.attPidPitch.update(tiltSetpointZ, bodyUpWorld.z, dt),
      -0.35,
      0.35,
    );
    const gimbalYaw = clamp(
      this.attPidYaw.update(tiltSetpointX, bodyUpWorld.x, dt),
      -0.35,
      0.35,
    );

    const base = neutralControl(this.finCount, this.flapCount);
    return {
      ...base,
      engineGroups: throttle,
      enginesOn,
      gimbalPitch,
      gimbalYaw,
      fins: new Array(this.finCount).fill(
        pos.y - 91 < 50_000 ? 0.25 : 0,
      ) as number[],
      flaps: new Array(this.flapCount).fill(0) as number[],
    };
  }

  // -------------------------------------------------------------------------

  private maybeRequestPlan(world: World): void {
    if (this.inFlight) return;
    if (world.t - this.lastRequestT < this.replanIntervalS) return;
    this.lastRequestT = world.t;
    this.inFlight = true;

    const req: MPCSolveRequest = {
      position: { ...world.rigidBody.position },
      velocity: { ...world.rigidBody.velocity },
      massKg: world.rigidBody.mass,
      vehicle: {
        dryMassKg: world.mass.dryMass,
        maxThrustN: this.maxThrustN,
        minThrustN: this.minThrustN,
        ispS: this.ispS,
      },
      mode: "scvx",
    };
    const plan = this.plan;
    if (plan !== null) {
      const remaining = plan.tF - (world.t - plan.t0);
      if (remaining > 1) req.tFHintS = remaining;
    }
    const t0 = world.t;

    void this.transport(req)
      .then((resp) => {
        this.inFlight = false;
        if (
          resp.status !== "optimal" ||
          resp.terminalSlack > MAX_USABLE_TERMINAL_SLACK ||
          resp.predictedPositions.length < 2
        ) {
          return; // keep the previous plan / fallback
        }
        const toVec3 = (p: { x: number; y: number; z: number }) =>
          Vec3.of(p.x, p.y, p.z);
        const next: MPCPlan = {
          t0,
          tF: resp.tFS,
          dtNode: resp.tFS / resp.thrustAccel.length,
          positions: resp.predictedPositions.map(toVec3),
          velocities: resp.predictedVelocities.map(toVec3),
          thrustAccel: resp.thrustAccel.map(toVec3),
          solveTimeMs: resp.solveTimeMs,
          fuelKg: resp.fuelKg,
        };
        this.plan = next;
        this.observer?.(next);
      })
      .catch(() => {
        this.inFlight = false; // service unreachable → PID keeps flying
      });
  }

  /**
   * Inverse of the activation ladder: the ladder command x that lights
   * enough engines to produce `f` × full-stack thrust. The ladder's
   * engines-lit curve is piecewise linear in x with breakpoints at
   * x ∈ {0, 0.2, 0.5, 0.6, 1}: 0 → 3 → 10.5 → 17 → 33 engines
   * (centre ramps ×5, inner joins at 0.2 ramping ×2.5, outer at 0.5
   * ramping ×2). Invert per segment; clamp outside.
   */
  private ladderCmdForThrustFraction(f: number): number {
    const target = clamp(f, 0, 1) * 33;
    // [xStart, xEnd, enginesStart, enginesEnd] per ladder segment.
    const segments: readonly (readonly [number, number, number, number])[] = [
      [0, 0.2, 0, 3],
      [0.2, 0.5, 3, 10.5],
      [0.5, 0.6, 10.5, 17],
      [0.6, 1, 17, 33],
    ];
    for (const [x0, x1, e0, e1] of segments) {
      if (target <= e1) {
        return x0 + ((target - e0) / (e1 - e0)) * (x1 - x0);
      }
    }
    return 1;
  }

  /** Same activation ladder as the PID baseline (centre → inner → outer). */
  private allocateThrottle(cmd: number): EngineGroupBag<number> {
    if (cmd <= 0) return { centre: 0, inner: 0, outer: 0, ship: 0 };
    const x = clamp(cmd, 0, 1);
    const centre = clamp(x * 5, 0, 1);
    const inner = clamp((x - 0.2) * 2.5, 0, 1);
    const outer = clamp((x - 0.5) * 2, 0, 1);
    return { centre, inner, outer, ship: 0 };
  }
}
