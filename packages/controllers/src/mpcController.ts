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
  constantWind,
  densityAt,
  neutralControl,
  simStep,
  type ControlInput,
  type EngineGroupBag,
  type SimEnv,
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
  /** Remaining committed coast (s) — coast+burn re-plans refine the
   *  ignition epoch inside a narrow window instead of re-opening it. */
  coastHintS?: number;
  /**
   * "scvx" iterates drag relinearization (SLS-27); "coast+burn" adds the
   * ballistic-coast ignition search (SLS-47) — the default, since
   * burn-only plans are infeasible from high altitude (thrust floor) and
   * zero-drag "linear" plans are unflyable through the transonic regime.
   */
  mode?: "linear" | "scvx" | "coast+burn";
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
  /** coast+burn only (SLS-47): seconds from the request state to planned
   *  ignition; the coast arrays end at the ignition state (= burn node 0). */
  ignitionTimeS?: number | null;
  coastPositions?: { x: number; y: number; z: number }[] | null;
  coastVelocities?: { x: number; y: number; z: number }[] | null;
};

export type MPCTransport = (req: MPCSolveRequest) => Promise<MPCSolveResponse>;

/** Plan as consumed by the tracker: world-time-anchored arrays. */
export type MPCPlan = {
  /** World sim time when the plan's node 0 applies. */
  t0: number;
  /** BURN duration (s). The full plan spans ignitionTimeS + tF. */
  tF: number;
  dtNode: number;
  /** Coast duration before the burn (0 for burn-only plans). */
  ignitionTimeS: number;
  /** Ballistic coast samples, ending at the ignition state (overlay). */
  coastPositions: Vec3[];
  /** Burn trajectory from the ignition state. */
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
  /** Re-plan cadence in sim seconds during the BURN (ADR-007: 1 Hz). */
  replanIntervalS?: number;
  /** Solver mode; default "coast+burn" (SLS-47). */
  mode?: "linear" | "scvx" | "coast+burn";
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

/** Re-plan cadence while coasting (SLS-47) — the trajectory is passive,
 *  so 1 Hz would waste solver time; the coast+burn search costs ~1 s. */
const COAST_REPLAN_INTERVAL_S = 3;

/** Freeze re-planning this close to ignition so the ignition time can't
 *  churn right at the coast→burn mode switch. */
const COAST_FREEZE_BEFORE_IGNITION_S = 1;

/**
 * Abort a COMMITTED burn only when reality has drifted this far from the
 * plan — the feedforward is then fiction and the PID fallback is safer.
 * Healthy tracked burns stay within tens of metres; time-based staleness
 * (the old rule) dropped healthy burns to PID whenever re-plans failed,
 * wasting the committed trajectory at T-minus-seconds.
 */
const BURN_ABORT_DIVERGENCE_M = 4_000;

/**
 * Alignment window (s) before ignition: the centre engines run at their
 * floor purely for GIMBAL AUTHORITY — with engines off a coasting booster
 * cannot reorient (gimbal torque needs thrust; grid fins are negligible
 * above ~30 km), so it would reach ignition still retrograde and dump
 * 80 %+ of the ignition impulse sideways (measured: vz −300 → −40 while
 * the plan wanted −367). ~3 t of propellant, inside the plan's 2 %
 * reserve.
 */
const IGNITION_ALIGN_S = 5;

/**
 * Event-triggered burn re-planning: request a fresh plan only when
 * tracking drift exceeds this. Time-based 1 Hz re-plans kept re-anchoring
 * the plan clock to node 0, replaying the ignition impulse indefinitely.
 */
const BURN_REPLAN_DRIFT_M = 600;

// ---------------------------------------------------------------------------
// Fin-steered descent (SLS-49): during the fall, the booster trims its
// ballistic impact point with body tilt (angle of attack) — grid fins +
// the tilted airflow produce ~0.3–0.5 m/s² of lateral authority in the
// dense layers, worth ~1–2 km of impact correction over a full fall.
// This mirrors the real vehicle: boostback aims the fall near the pad,
// fins trim, engines only light for the short terminal burn.
// ---------------------------------------------------------------------------

/** Re-predict the ballistic impact point this often (sim s). */
const IMPACT_PREDICT_INTERVAL_S = 2;

/** Steering gain: tilt (rad) per metre of predicted impact error. */
const STEER_GAIN_RAD_PER_M = 0.00022;

/** Max steering tilt (~15°; fin stall margin is 25°). Raised from 10°
 *  for SLS-47: MC jitter scatters the ballistic impact point by up to
 *  ~1.5 km (p90) on top of the deliberate +800 m aim offset, and the
 *  10° cap left tail seeds entering the burn with > 2 km to divert. */
const STEER_TILT_MAX_RAD = 0.26;

/** Ignore impact errors below this — the terminal burn cleans up. */
const STEER_DEADBAND_M = 25;

/**
 * Attitude control is gated on dynamic pressure during the coast: with
 * engines off, fins are the only actuator and above ~30 km they have no
 * authority — running the PIDs there just winds up integrators that
 * slam the vehicle when the fins finally bite (the fin-geometry fix
 * removed the old model's accidental passive weathervane stability).
 */
const COAST_MIN_Q_PA = 2_000;

/**
 * Steering tilt setpoints from a predicted impact error. MEASURED sim
 * sign convention: leaning bodyUp toward +z accelerates the vehicle
 * toward −z (the canted-drag/fin force opposes the lean), so to move
 * the impact point −z (error e_z > 0) we lean +z: tilt = +k·e.
 */
export function impactSteeringTilt(
  errorX: number,
  errorZ: number,
): { tiltX: number; tiltZ: number } {
  const mag = Math.hypot(errorX, errorZ);
  if (mag < STEER_DEADBAND_M) return { tiltX: 0, tiltZ: 0 };
  return {
    tiltX: clamp(STEER_GAIN_RAD_PER_M * errorX, -STEER_TILT_MAX_RAD, STEER_TILT_MAX_RAD),
    tiltZ: clamp(STEER_GAIN_RAD_PER_M * errorZ, -STEER_TILT_MAX_RAD, STEER_TILT_MAX_RAD),
  };
}

/**
 * Differential grid-fin mixer (SLS-49). Measured single-fin torque signs
 * in axial flow (fins order [+x, +z, −x, −z], positive deflection):
 * fin0 → −ωx, fin2 → +ωx, fin1 → −ωz, fin3 → +ωz (collective → roll).
 * MEASURED gimbal convention: pitchCmd > 0 → −ωx, yawCmd > 0 → −ωz
 * (both axes). Fins must produce the SAME torque direction as the
 * gimbal for the same command (an earlier assumed-sign mixer had them
 * fighting — attitude followed the fins at high q and the gimbal at
 * low q, limit-cycling between them):
 *   pitchCmd > 0 → fin0 +δ, fin2 −δ;  yawCmd > 0 → fin1 +δ, fin3 −δ.
 * Commands are gimbal-scaled radians; fins get a 1.33× range scale-up
 * (fin max 0.349 rad vs gimbal 0.262).
 */
const FIN_PER_GIMBAL = 1.33;

/**
 * Explicit angular-rate damping (rad of command per rad/s of body rate),
 * applied to gimbal + fins alike. The attitude PIDs' filtered
 * derivative-on-measurement is tuned for small errors; in the terminal
 * flare (low q, varying thrust) the loop limit-cycled rail-to-rail
 * (measured upZ swinging ±1 with ±lateral thrust pulses). Rate feedback
 * kills the cycle. Signs follow the measured actuator convention
 * (cmd+ → ω− on both axes): damping term = +K·ω per axis.
 */
const RATE_DAMP = 1.2;

/**
 * Large-angle geometric righting (SLS-49). The component PIDs control
 * bodyUp.x/z toward small setpoints — a formulation that is BLIND to
 * inversion: a nose-down vehicle has upX = upZ ≈ 0 and reads as
 * "on target". With the real fin model the coast is neutrally stable,
 * so slow flips happen — and thrust then fires DOWNWARD (measured:
 * vy −148 → −257 under full 13-engine thrust). Below UPY_PID_THRESHOLD
 * the controller switches to the geometric law: desired rotation axis
 * = bodyUp × targetDir; command = −K·axis (actuator cmd+ → ω−) plus
 * rate damping.
 */
const UPY_PID_THRESHOLD = 0.7;

/**
 * Terminal DOCK phase (SLS-49): when the burn plan's clock runs out with
 * the vehicle slow and near the slot (the plan ends at the catch box,
 * not inside the arms), a gravity-compensated hover-descent flies the
 * final metres — the real vehicle's "translate into the chopsticks"
 * act. Without it, plan expiry handed a perfect 80 m hover to the PID
 * fallback, which flies a whole descent profile and destroys it.
 */
const DOCK_MAX_LATERAL_M = 300;
const DOCK_MAX_ALT_M = 400;

// ---------------------------------------------------------------------------
// SLS-47 dispersion-robustness terminal logic. Probe taxonomy (8 jittered
// seeds): every miss was one of two self-inflicted failures —
//  (A) the dock's forced ≥0.5 m/s descent sank an uncentred vehicle
//      through slot height (10–70 m lateral wander vs the 10 m envelope),
//      ending in a tower strike from metres away;
//  (B) late in the burn the stack is light enough that the 3-engine
//      thrust FLOOR exceeds weight — one over-braked correction and vy
//      is driven through zero into a climb the floored engines cannot
//      stop (probe: vy +75…+192 m/s at 800 m, re-ascending to 2–7 km).
// ---------------------------------------------------------------------------

/** Dock "centred" gate: descend through the slot only inside this — the
 *  catch envelope is 10 m / 2 m/s, so sinking uncentred is a strike. */
const DOCK_CENTRED_LAT_M = 6;
const DOCK_CENTRED_VLAT_MPS = 1.2;

/** Uncentred descent cap (m/s): creep down while centring far above the
 *  slot, hold (0) once close. Only when hovering is physically possible. */
const DOCK_UNCENTRED_DESCENT_MAX_MPS = 4;
const DOCK_HOLD_BAND_M = 50;

/** Climb-back rate (m/s) after sinking below slot height uncentred. */
const DOCK_CLIMB_BACK_MPS = 1;

/** Dock tilt setpoints are SLEW-LIMITED (rad, rad/s): the raw lateral
 *  PD flips its command sign faster than the attitude loop's
 *  seconds-scale lag, and the attitude swings rail-to-rail — a ±5 m/s
 *  lateral limit cycle that holds the vehicle just outside the 2 m/s
 *  envelope forever (probe: lat 5 m / vLat 2.3 m/s, strike at 29 m).
 *  Limiting the setpoint's rate below the lag breaks the cycle; the
 *  smaller cap trades authority (0.6 m/s²) for smoothness, plenty
 *  against a ≤ 2 m/s residual. */
/** Precision-regime authority sets the residual lateral wobble almost
 *  linearly (probe: 0.06 rad → vLat residual up to 2.33 m/s, a hair over
 *  the 2 m/s envelope; 0.04 → ~1.5 ✓ but the attitude loop overshoots
 *  the setpoint ~45 % and 0.04 commanded → 3.3° actual, over the 3°
 *  envelope. 0.03 commanded ≈ 2.5° worst-case actual clears both. */
const DOCK_TILT_MAX_RAD = 0.03;
const DOCK_TILT_SLEW_RAD_PER_S = 0.02;

/** Two-regime dock tilt: while the handoff is still hot (burn residue —
 *  probe: vz ≈ −25 m/s entering the dock), the precision limits above
 *  turn the approach into a ±800 m, 160 s pendulum that drains the tank
 *  hovering. Far from the envelope the cycle risk is irrelevant — use
 *  double the authority and slew; the precision limits engage close in. */
const DOCK_TILT_MAX_FAR_RAD = 0.12;
const DOCK_TILT_SLEW_FAR_RAD_PER_S = 0.06;
const DOCK_FAR_LAT_ERR_M = 30;
const DOCK_FAR_LAT_SPEED_MPS = 5;

/** Dock float band (m/s): once the stack is too light to hover (floor
 *  thrust > weight), lit engines can only climb — the probe's runaway
 *  ascent to 100+ km. Descent is delivered by engine PULSES: cut when
 *  vy rises this far above the target, relight when it falls this far
 *  below. Ripple at the floor's ~4 m/s² is centimetres. */
const DOCK_FLOAT_BAND_MPS = 0.75;

/** Extra rate damping inside the dock. Each float-pulse thrust
 *  transient re-excites the attitude loop; at RATE_DAMP=1.2 it rings to
 *  ±3.0–3.4° — sampled at capture entry, that's a coin-flip against the
 *  3° envelope (probe round 4: three near-misses, all "tilt 3.0–3.4°").
 *  (Softening kp/kd instead loosened setpoint tracking and made the
 *  vehicle drift into the tower — probe round 5.) */
const DOCK_RATE_DAMP = 2.5;

/** Dock approach aim is biased AWAY from the tower in +x (m). The truss
 *  collision box reaches x = +6 and the slot centre sits at x = 8.5 —
 *  a 2.5 m corridor that the dock's residual ±3–4 m wander crosses
 *  (probe: every "near miss" was a strike at y 100–146 with single-digit
 *  lateral error). Aiming at x ≈ 10.5 doubles the truss margin while
 *  staying well inside the capture volume (x ∈ [5, 12]) and the 10 m
 *  3-D catch envelope. */
const DOCK_APPROACH_X_BIAS_M = 1.25;

/** Hover is possible only while floor thrust ≤ this fraction of weight. */
const HOVER_MARGIN = 0.98;

/** Float guard (failure B): engines-off hysteresis band. Enter when the
 *  demand is pinned at the floor and the fall is nearly arrested while
 *  still above the dock band; exit once falling this fast again. Pulses
 *  last ~1 s (Δvy 10 m/s at g) — short enough that attitude drift with
 *  damped rates is negligible, unlike the km-scale freefall of shutting
 *  down for good (SLS-49 probe). */
const FLOAT_ENTER_VY_MPS = -5;
const FLOAT_EXIT_VY_MPS = -15;

/** Plan-clock expiry only counts once the vehicle is actually down at
 *  the plan's end altitude — the ALTITUDE-indexed tracker (below) means
 *  a float pulse or slow patch leaves the clock expired while the
 *  profile still has braking to do. */
const PLAN_END_ALT_GRACE_M = 100;

/**
 * Dock vertical-speed target (m/s, negative = descend) — pure so the
 * regime logic is unit-testable (SLS-47).
 */
export function dockVerticalTarget(
  dyAboveSlotM: number,
  latErrM: number,
  latSpeedMps: number,
  hoverable: boolean,
): number {
  const centred =
    latErrM < DOCK_CENTRED_LAT_M && latSpeedMps < DOCK_CENTRED_VLAT_MPS;
  if (dyAboveSlotM < -2) {
    // Sank below the slot: climb back. Works light or heavy — a floored
    // lit engine set out-lifts a light stack by construction, and the
    // float pulses regulate the rate (probe: a "hold at 0" here let a
    // light vehicle sag 90 m to the ground over 3 minutes).
    return DOCK_CLIMB_BACK_MPS;
  }
  if (centred || !hoverable) {
    // Committed descent (the pre-SLS-47 law): floor at 0.5 m/s so the
    // approach always terminates. Also the only option when the floor
    // exceeds weight — an uncentred hover is not on the menu then.
    return -clamp(DOCK_DESCENT_GAIN * dyAboveSlotM, 0.5, DOCK_DESCENT_MAX_MPS);
  }
  if (dyAboveSlotM <= DOCK_HOLD_BAND_M) return 0; // hold height, centre first
  return -clamp(
    DOCK_DESCENT_GAIN * dyAboveSlotM,
    0,
    DOCK_UNCENTRED_DESCENT_MAX_MPS,
  );
}

/**
 * Engines-off float guard for the burn phase (failure B) — pure for
 * tests. `floating` is the current latch (hysteresis).
 */
export function shouldFloat(
  demandN: number,
  floorN: number,
  vyMps: number,
  altAboveSlotM: number,
  floating: boolean,
): boolean {
  if (altAboveSlotM <= DOCK_ENGAGE_ALT_M) return false; // dock's problem
  if (demandN > floorN) return false; // engines can deliver the demand
  return floating ? vyMps > FLOAT_EXIT_VY_MPS : vyMps > FLOAT_ENTER_VY_MPS;
}

/** Engage the dock at this height above the slot during a burn — the
 *  altitude-indexed tracker reaches the ground before the plan CLOCK
 *  expires, so clock-based engagement never fires. */
const DOCK_ENGAGE_ALT_M = 500;
const DOCK_DESCENT_GAIN = 0.12;
const DOCK_DESCENT_MAX_MPS = 8;
/** Lateral loop DE-tuned for SLS-47: the tilt→attitude path has a
 *  seconds-scale lag, and both the original 0.08/0.55 and a stiffened
 *  0.15/0.9 limit-cycled around it (probe: ±10 m at ~5 m/s, ω≈0.5 rad/s
 *  — right at the lag crossover; the envelope needs < 2 m/s). Bandwidth
 *  must sit BELOW the lag: ω_n≈0.22 rad/s, ζ≈1.3. Convergence from
 *  50 m takes ~30 s — the hold-until-centred vertical law buys it. */
const DOCK_LAT_KP = 0.05;
const DOCK_LAT_KD = 0.6;
const DOCK_LAT_ACC_MAX = 2.0;
const G_MPS2 = 9.80665;
const RIGHTING_GAIN = 2.5;

function attitudeCommands(
  bodyUp: Vec3,
  tiltX: number,
  tiltZ: number,
  wBody: Vec3,
  pidPitch: PID,
  pidYaw: PID,
  dt: number,
  maxRad: number,
  rateDamp: number = RATE_DAMP,
): { pitch: number; yaw: number } {
  if (bodyUp.y < UPY_PID_THRESHOLD) {
    // Geometric righting toward the (near-vertical) target direction.
    const ty = Math.sqrt(Math.max(0, 1 - tiltX * tiltX - tiltZ * tiltZ));
    const target = Vec3.of(tiltX, ty, tiltZ);
    const axis = Vec3.cross(bodyUp, target);
    pidPitch.reset();
    pidYaw.reset();
    return {
      pitch: clamp(-RIGHTING_GAIN * axis.x + rateDamp * wBody.x, -maxRad, maxRad),
      yaw: clamp(-RIGHTING_GAIN * axis.z + rateDamp * wBody.z, -maxRad, maxRad),
    };
  }
  // Axis-asymmetric polarity (derived + probe-verified): actuator cmd+
  // gives ω− on both axes, but d(upZ)/dt = +ωx while d(upX)/dt = −ωz —
  // so the pitch PID output must be negated and the yaw output must NOT.
  return {
    pitch: clamp(
      -pidPitch.update(tiltZ, bodyUp.z, dt) + rateDamp * wBody.x,
      -maxRad,
      maxRad,
    ),
    yaw: clamp(
      pidYaw.update(tiltX, bodyUp.x, dt) + rateDamp * wBody.z,
      -maxRad,
      maxRad,
    ),
  };
}
export function mixFins(pitchCmd: number, yawCmd: number): number[] {
  const p = pitchCmd * FIN_PER_GIMBAL;
  const y = yawCmd * FIN_PER_GIMBAL;
  return [p, y, -p, -y];
}

/** Below this height above the target, cap the demanded tilt (rad) —
 *  attitude authority (∝ dynamic pressure and throttle) collapses in the
 *  terminal flare and large demands overshoot into a tip-over. */
const TERMINAL_TILT_ALT_M = 600;
const TERMINAL_TILT_MAX_RAD = 0.09;

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

/**
 * Vertical correction clamp (m/s²) — separate from the lateral clamp:
 * vertical thrust corrections don't fight the attitude loop, and they
 * are what closes deceleration shortfalls before the ground arrives.
 */
const TRACK_CORRECTION_VERT_MAX = 15;

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
  private readonly mode: "linear" | "scvx" | "coast+burn";
  private readonly gainsRef: () => PIDControllerGains;
  private readonly fallback: PIDController;
  private readonly attPidPitch: PID;
  private readonly attPidYaw: PID;
  private readonly maxThrustN: number;
  private readonly minThrustN: number;
  private readonly ispS: number;
  private readonly maxGimbalRad: number;
  /** Engine groups in activation order, with floor-aware thrust data. */
  private readonly thrustGroups: {
    group: keyof EngineGroupBag<number>;
    /** Group total at full throttle (N). */
    maxN: number;
    /** Group total with every engine clamped at its floor (N). */
    minN: number;
  }[];

  private plan: MPCPlan | null = null;
  /** Latest sim time seen by step() — the acceptance-time clock for
   *  in-flight responses (their closures hold the REQUEST-time world). */
  private lastWorldT = 0;
  private lastRequestT = -Infinity;
  /** Fin-steering state: cached impact prediction (SLS-49). */
  private lastImpactPredictT = -Infinity;
  private impactError: { x: number; z: number } = { x: 0, z: 0 };
  private readonly rolloutEnv: SimEnv = {
    wind: constantWind(Vec3.ZERO),
    gravity: 9.80665,
  };
  private readonly vehicle: Vehicle;
  private readonly targetPosition: Vec3;
  private inFlight = false;
  private observer: MPCPlanObserver | null = null;
  /** Exposed for the HUD: true while the PID fallback is steering. */
  private usingFallback = true;
  /** Terminal dock phase latch (SLS-49). */
  private dockMode = false;
  /** Engines-off float latch during the burn (SLS-47, failure B). */
  private floating = false;
  /** Slew-limited dock tilt setpoints (SLS-47, dock limit cycle). */
  private dockTiltX = 0;
  private dockTiltZ = 0;

  constructor(opts: MPCControllerOpts) {
    this.vehicle = opts.vehicle;
    this.targetPosition = opts.targetPosition;
    this.finCount = opts.vehicle.surfaces.filter(
      (s) => s.kind === "grid_fin",
    ).length;
    this.flapCount = opts.vehicle.surfaces.filter(
      (s) => s.kind === "flap",
    ).length;
    this.transport =
      opts.transport ?? fetchTransport(opts.serviceUrl ?? DEFAULT_SERVICE_URL);
    this.replanIntervalS = opts.replanIntervalS ?? 1.0;
    this.mode = opts.mode ?? "coast+burn";
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
    this.minThrustN = minSet.reduce(
      (s, e) => s + e.minThrottle * e.thrustSea,
      0,
    );
    this.ispS =
      engines.reduce((s, e) => s + e.ispSea, 0) / Math.max(engines.length, 1);
    this.maxGimbalRad = gimballed.reduce(
      (m, e) => Math.max(m, e.maxGimbal),
      0,
    );

    // Per-group thrust envelopes in activation order, respecting the
    // plant's per-engine throttle floor: a LIT engine never produces
    // less than minThrottle × thrustSea (thrust.ts clamps up), so
    // allocation must reason in floor-aware bands, not proportions.
    const order: (keyof EngineGroupBag<number>)[] = [
      "centre",
      "inner",
      "outer",
      "ship",
    ];
    this.thrustGroups = order
      .map((group) => {
        const members = engines.filter(
          (_, i) => opts.vehicle.engineGroupOf[i] === group,
        );
        return {
          group,
          maxN: members.reduce((s, e) => s + e.thrustSea, 0),
          minN: members.reduce((s, e) => s + e.minThrottle * e.thrustSea, 0),
        };
      })
      .filter((g) => g.maxN > 0);
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
    this.dockMode = false;
    this.floating = false;
    this.dockTiltX = 0;
    this.dockTiltZ = 0;
    this.lastWorldT = 0;
    this.lastRequestT = -Infinity;
    this.usingFallback = true;
    this.fallback.reset();
    this.attPidPitch.reset();
    this.attPidYaw.reset();
    this.observer?.(null);
  }

  step(world: World, dt: number): ControlInput {
    this.lastWorldT = world.t;
    this.maybeRequestPlan(world);

    const plan = this.plan;
    const tInPlan = plan === null ? Infinity : world.t - plan.t0;
    // Burn-relative clock: negative during the coast (which is passive
    // and stays valid for its whole duration).
    const tBurn = plan === null ? Infinity : tInPlan - plan.ignitionTimeS;
    // The clock alone does not exhaust a plan: the ALTITUDE-indexed
    // tracker (and float pulses, SLS-47) can leave the clock expired with
    // braking still to do — the plan is done only once the vehicle is
    // actually down at its end altitude.
    const planEndY =
      plan === null
        ? -Infinity
        : plan.positions[plan.positions.length - 1]!.y;
    const planExhausted =
      plan !== null &&
      tInPlan >= 0 &&
      tBurn >= plan.tF &&
      world.rigidBody.position.y <= planEndY + PLAN_END_ALT_GRACE_M;
    if (this.dockMode || planExhausted) {
      // Plan clock exhausted — dock if we are close and slow, else PID.
      const pos = world.rigidBody.position;
      const dx = this.targetPosition.x - pos.x;
      const dz = this.targetPosition.z - pos.z;
      const dy = pos.y - this.targetPosition.y;
      if (
        this.dockMode ||
        (Math.hypot(dx, dz) < DOCK_MAX_LATERAL_M &&
          dy > -5 &&
          dy < DOCK_MAX_ALT_M)
      ) {
        this.dockMode = true;
        this.usingFallback = false;
        return this.dockStep(world, dt);
      }
      this.usingFallback = true;
      return this.fallback.step(world, dt);
    }
    if (plan === null || tInPlan < 0) {
      this.usingFallback = true;
      return this.fallback.step(world, dt);
    }
    // Once burning, COMMIT to the plan even if re-plans fail — a landing
    // burn tracked to touchdown beats a mid-burn PID handoff. The safety
    // net is divergence, not time: abort only if reality has drifted so
    // far from the plan that the feedforward is fiction (the SLS-48
    // failure mode this replaces was time-based staleness, which
    // dropped healthy committed burns to PID at T-minus-seconds).
    if (tBurn >= 0) {
      const kAbort = Math.min(
        Math.floor(tBurn / plan.dtNode),
        plan.positions.length - 1,
      );
      const drift = Vec3.length(
        Vec3.sub(plan.positions[kAbort]!, world.rigidBody.position),
      );
      if (drift > BURN_ABORT_DIVERGENCE_M) {
        this.usingFallback = true;
        return this.fallback.step(world, dt);
      }
    }
    this.usingFallback = false;

    if (tBurn < 0) {
      // --- Coast phase (SLS-47/49). Engines off; the fall is steered by
      // body tilt (fins + canted airflow) toward the ballistic aim point,
      // like the real vehicle. In the final IGNITION_ALIGN_S the target
      // switches to the burn's initial thrust direction and the centre
      // engines run at their floor so the gimbal has swing authority. ---
      const g = this.gainsRef();
      this.attPidPitch.gains = g.attitudePitch;
      this.attPidYaw.gains = g.attitudeYaw;
      const aligningNow = -tBurn <= IGNITION_ALIGN_S;
      let tiltX: number;
      let tiltZ: number;
      if (aligningNow) {
        const u0 = plan.thrustAccel[0]!;
        const u0Mag = Vec3.length(u0);
        const burnDir =
          u0Mag > 1e-6 ? Vec3.scale(u0, 1 / u0Mag) : Vec3.of(0, 1, 0);
        tiltX = clamp(burnDir.x, -g.maxTiltRad, g.maxTiltRad);
        tiltZ = clamp(burnDir.z, -g.maxTiltRad, g.maxTiltRad);
      } else {
        // Impact-point trim: forward-roll the fall (engines off, no wind
        // assumption) every couple of seconds and lean into the error.
        if (world.t - this.lastImpactPredictT >= IMPACT_PREDICT_INTERVAL_S) {
          this.lastImpactPredictT = world.t;
          this.impactError = this.predictImpactError(world);
        }
        const steer = impactSteeringTilt(this.impactError.x, this.impactError.z);
        tiltX = steer.tiltX;
        tiltZ = steer.tiltZ;
      }
      const bodyUpWorld = Quat.rotateVec3(
        world.rigidBody.attitude,
        Vec3.of(0, 1, 0),
      );
      const speed = Vec3.length(world.rigidBody.velocity);
      const qPa =
        0.5 * densityAt(world.rigidBody.position.y) * speed * speed;
      let gimbalPitch = 0;
      let gimbalYaw = 0;
      if (qPa >= COAST_MIN_Q_PA || aligningNow) {
        const wB = world.rigidBody.angularVelocity;
        const cmds = attitudeCommands(
          bodyUpWorld,
          tiltX,
          tiltZ,
          wB,
          this.attPidPitch,
          this.attPidYaw,
          dt,
          this.maxGimbalRad,
        );
        gimbalPitch = cmds.pitch;
        gimbalYaw = cmds.yaw;
      } else {
        // No authority up here — keep the PIDs quiescent (no windup).
        this.attPidPitch.reset();
        this.attPidYaw.reset();
      }
      const aligning = -tBurn <= IGNITION_ALIGN_S;
      const centre = aligning
        ? this.allocateForThrust(this.minThrustN).centre
        : 0;
      const base = neutralControl(this.finCount, this.flapCount);
      return {
        ...base,
        engineGroups: { centre, inner: 0, outer: 0, ship: 0 },
        enginesOn: {
          centre: aligning && centre > 0,
          inner: false,
          outer: false,
          ship: false,
        },
        gimbalPitch,
        gimbalYaw,
        fins: mixFins(gimbalPitch, gimbalYaw).slice(0, this.finCount),
        flaps: new Array(this.flapCount).fill(0) as number[],
      };
    }

    // Dock engagement by ALTITUDE (see DOCK_ENGAGE_ALT_M).
    {
      const dxE = this.targetPosition.x - world.rigidBody.position.x;
      const dzE = this.targetPosition.z - world.rigidBody.position.z;
      const dyE = world.rigidBody.position.y - this.targetPosition.y;
      if (dyE < DOCK_ENGAGE_ALT_M && Math.hypot(dxE, dzE) < DOCK_MAX_LATERAL_M) {
        this.dockMode = true;
        this.usingFallback = false;
        return this.dockStep(world, dt);
      }
    }

    // --- Burn phase: ALTITUDE-indexed plan lookup (SLS-49). Time-indexed
    // tracking under-braked whenever the vehicle fell ahead of the plan
    // clock (the feedforward stayed on an earlier, gentler node while the
    // ground approached) — indexing by current altitude keeps the
    // deceleration profile phased to reality. Falls back to the time
    // index if the plan's altitude profile is locally non-monotone. ---
    const pos = world.rigidBody.position;
    const vel = world.rigidBody.velocity;
    let k = Math.min(Math.floor(tBurn / plan.dtNode), plan.thrustAccel.length - 1);
    let frac = clamp(tBurn / plan.dtNode - k, 0, 1);
    if (plan.positions[0]!.y > plan.positions[plan.positions.length - 1]!.y) {
      let ka = 0;
      while (
        ka < plan.positions.length - 2 &&
        plan.positions[ka + 1]!.y > pos.y
      ) {
        ka++;
      }
      const yHi = plan.positions[ka]!.y;
      const yLo = plan.positions[Math.min(ka + 1, plan.positions.length - 1)]!.y;
      k = Math.min(ka, plan.thrustAccel.length - 1);
      frac = yHi > yLo ? clamp((yHi - pos.y) / (yHi - yLo), 0, 1) : 0;
    }
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

    // --- Feedforward + PD tracking correction → commanded thrust accel.
    // Axis-split clamp: vertical correction doesn't fight the attitude
    // loop (thrust is near-vertical), so it may be strong — it is what
    // closes deceleration shortfalls. Lateral stays soft (attitude lag). ---
    const rawCorr = Vec3.add(
      Vec3.scale(Vec3.sub(rStar, pos), TRACK_KP),
      Vec3.scale(Vec3.sub(vStar, vel), TRACK_KD),
    );
    const latMag = Math.hypot(rawCorr.x, rawCorr.z);
    const latScale =
      latMag > TRACK_CORRECTION_MAX ? TRACK_CORRECTION_MAX / latMag : 1;
    const correction = Vec3.of(
      rawCorr.x * latScale,
      clamp(rawCorr.y, -TRACK_CORRECTION_VERT_MAX, TRACK_CORRECTION_VERT_MAX),
      rawCorr.z * latScale,
    );
    let aCmd = Vec3.add(uStar, correction);
    // SLS-47 (failure B, root cause): a min-fuel plan's tail is bang-bang
    // max braking, and the ALTITUDE-indexed lookup maps an
    // already-too-slow vehicle onto exactly those nodes — feedforward
    // ~28 m/s² that the ±15 correction cannot cancel, driving vy through
    // zero into a full-thrust climb (probe: −164 → +74 m/s at 800 m).
    // When the vehicle is already descending slower than the plan calls
    // for at this altitude, cap the commanded vertical acceleration just
    // below gravity so it can only ease back down toward the profile.
    if (vel.y > vStar.y && aCmd.y > G_MPS2 - 0.5) {
      aCmd = Vec3.of(aCmd.x, G_MPS2 - 0.5, aCmd.z);
    }

    // --- Convert to throttle + attitude setpoints ---
    const g = this.gainsRef();
    this.attPidPitch.gains = g.attitudePitch;
    this.attPidYaw.gains = g.attitudeYaw;

    const aMag = Vec3.length(aCmd);
    const m = world.rigidBody.mass;

    // Float guard (SLS-47, failure B): when the demand sits below the
    // 3-engine floor and the fall is nearly arrested while still above
    // the dock band, a lit floor out-lifts the (light) stack and drives
    // vy through zero into a climb. Pulse the engines OFF until the
    // vehicle falls at FLOAT_EXIT again; fins hold attitude toward the
    // plan's thrust direction so the relight is aligned.
    this.floating = shouldFloat(
      aMag * m,
      this.minThrustN,
      vel.y,
      pos.y - this.targetPosition.y,
      this.floating,
    );
    if (this.floating) {
      const gF = this.gainsRef();
      this.attPidPitch.gains = gF.attitudePitch;
      this.attPidYaw.gains = gF.attitudeYaw;
      const uMag = Vec3.length(uStar);
      const uDir = uMag > 1e-6 ? Vec3.scale(uStar, 1 / uMag) : Vec3.of(0, 1, 0);
      const speed = Vec3.length(vel);
      const qPa = 0.5 * densityAt(pos.y) * speed * speed;
      let floatPitch = 0;
      let floatYaw = 0;
      if (qPa >= COAST_MIN_Q_PA) {
        const cmds = attitudeCommands(
          Quat.rotateVec3(world.rigidBody.attitude, Vec3.of(0, 1, 0)),
          clamp(uDir.x, -gF.maxTiltRad, gF.maxTiltRad),
          clamp(uDir.z, -gF.maxTiltRad, gF.maxTiltRad),
          world.rigidBody.angularVelocity,
          this.attPidPitch,
          this.attPidYaw,
          dt,
          this.maxGimbalRad,
        );
        floatPitch = cmds.pitch;
        floatYaw = cmds.yaw;
      } else {
        this.attPidPitch.reset();
        this.attPidYaw.reset();
      }
      const base = neutralControl(this.finCount, this.flapCount);
      return {
        ...base,
        engineGroups: { centre: 0, inner: 0, outer: 0, ship: 0 },
        enginesOn: { centre: false, inner: false, outer: false, ship: false },
        gimbalPitch: floatPitch,
        gimbalYaw: floatYaw,
        fins: mixFins(floatPitch, floatYaw).slice(0, this.finCount),
        flaps: new Array(this.flapCount).fill(0) as number[],
      };
    }

    // Floor-aware engine allocation: lighting a group commits every one
    // of its engines to at least the 40 % floor (the plant clamps lit
    // engines UP), so the old proportional ladder over-delivered ~4× the
    // planned thrust at small commands — the tank drained in 18 s and
    // MPC flew worse than PID (SLS-48 finding). Choose the smallest
    // engine set whose floor-aware band brackets the demand.
    // A landing burn never shuts down (real profile: 13 → 3 engines,
    // never 0): floor the demand at the centre engines' minimum. When
    // the vehicle runs slightly slow vs plan the surplus lift simply
    // slows the descent further, and the ALTITUDE-indexed tracker waits
    // — self-correcting. (Without this, negative vertical corrections
    // cut the engines mid-burn; the vehicle free-fell 1 km and the
    // terminal flare could not recover — SLS-49 probe.)
    const throttle = this.allocateForThrust(
      Math.max(aMag * m, this.minThrustN),
    );
    const enginesOn: EngineGroupBag<boolean> = {
      centre: throttle.centre > 0,
      inner: throttle.inner > 0,
      outer: throttle.outer > 0,
      ship: throttle.ship > 0,
    };

    // Tilt setpoints: desired thrust direction's horizontal components.
    // Terminal demand cap (SLS-49): below TERMINAL_TILT_ALT_M the attitude
    // authority collapses with dynamic pressure and throttle — capping the
    // demanded tilt keeps the loop from overshooting into a tip-over; the
    // tightened glide cone makes the plan finish its lateral work higher.
    const tiltLimit =
      pos.y - this.targetPosition.y < TERMINAL_TILT_ALT_M
        ? TERMINAL_TILT_MAX_RAD
        : g.maxTiltRad;
    const dir = aMag > 1e-6 ? Vec3.scale(aCmd, 1 / aMag) : Vec3.of(0, 1, 0);
    const tiltSetpointX = clamp(dir.x, -tiltLimit, tiltLimit);
    const tiltSetpointZ = clamp(dir.z, -tiltLimit, tiltLimit);

    const bodyUpWorld = Quat.rotateVec3(
      world.rigidBody.attitude,
      Vec3.of(0, 1, 0),
    );
    // Pre-clamp at the PLANT's gimbal limit (±0.262 rad for Raptor —
    // 0.35 rad/s is the slew RATE, a different number) so the attitude
    // PIDs' anti-windup unwinds where the engine actually saturates.
    // Negated-PID convention + inversion-safe righting: see
    // attitudeCommands().
    const cmds = attitudeCommands(
      bodyUpWorld,
      tiltSetpointX,
      tiltSetpointZ,
      world.rigidBody.angularVelocity,
      this.attPidPitch,
      this.attPidYaw,
      dt,
      this.maxGimbalRad,
    );
    const gimbalPitch = cmds.pitch;
    const gimbalYaw = cmds.yaw;

    const base = neutralControl(this.finCount, this.flapCount);
    return {
      ...base,
      engineGroups: throttle,
      enginesOn,
      gimbalPitch,
      gimbalYaw,
      fins: mixFins(gimbalPitch, gimbalYaw).slice(0, this.finCount),
      flaps: new Array(this.flapCount).fill(0) as number[],
    };
  }

  // -------------------------------------------------------------------------

  private maybeRequestPlan(world: World): void {
    if (this.inFlight) return;
    // During a planned coast, re-plan lazily (the trajectory is passive)
    // and freeze entirely in the final second before ignition so the
    // ignition time can't churn right at the mode switch. Once BURNING,
    // commit: re-plans are burn-only (mode "scvx") from the current
    // state — a landing burn is never shut down to go back to coasting.
    let interval = this.replanIntervalS;
    let requestMode = this.mode;
    let coastHintS: number | undefined;
    const plan = this.plan;
    if (plan !== null) {
      const ignitionIn = plan.ignitionTimeS - (world.t - plan.t0);
      if (ignitionIn > 0) {
        if (ignitionIn < COAST_FREEZE_BEFORE_IGNITION_S) return;
        interval = COAST_REPLAN_INTERVAL_S;
        coastHintS = ignitionIn;
      } else {
        // Burning: event-triggered re-planning only. A fresh plan means a
        // fresh ignition impulse at node 0 — re-anchoring every second
        // replayed that impulse indefinitely. Re-plan only when tracking
        // drift says the current feedforward is no longer credible.
        const tBurn = -ignitionIn;
        const k = Math.min(
          Math.floor(tBurn / plan.dtNode),
          plan.positions.length - 1,
        );
        const drift = Vec3.length(
          Vec3.sub(plan.positions[k]!, world.rigidBody.position),
        );
        if (drift < BURN_REPLAN_DRIFT_M) return;
        if (this.mode === "coast+burn") requestMode = "scvx";
      }
    }
    if (world.t - this.lastRequestT < interval) return;
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
      mode: requestMode,
    };
    if (coastHintS !== undefined) req.coastHintS = coastHintS;
    if (requestMode !== "coast+burn" && plan !== null) {
      // Burn-only modes benefit from a t_f hint; the coast+burn search
      // sweeps ignition time anyway and manages its own burn hints.
      const remaining =
        plan.ignitionTimeS + plan.tF - (world.t - plan.t0);
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
        // In-flight race guard: a coast+burn answer requested during the
        // coast can land after ignition has already happened — accepting
        // its fresh coast would shut the burn down. Discard it. (Uses the
        // acceptance-time clock; `world` here is the request-time state.)
        const cur = this.plan;
        if (
          cur !== null &&
          this.lastWorldT - cur.t0 >= cur.ignitionTimeS &&
          (resp.ignitionTimeS ?? 0) > 0.5
        ) {
          return;
        }
        const toVec3 = (p: { x: number; y: number; z: number }) =>
          Vec3.of(p.x, p.y, p.z);
        const next: MPCPlan = {
          t0,
          tF: resp.tFS,
          dtNode: resp.tFS / resp.thrustAccel.length,
          ignitionTimeS: resp.ignitionTimeS ?? 0,
          coastPositions: (resp.coastPositions ?? []).map(toVec3),
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

  /** Gravity-compensated hover-descent into the catch slot (SLS-49).
   *  SLS-47: the vertical law lives in dockVerticalTarget() — descend
   *  through the slot only once centred (10 m / 2 m/s envelope), hold
   *  height while off-centre when hovering is physically possible, and
   *  climb back after sinking below the slot uncentred. */
  private dockStep(world: World, dt: number): ControlInput {
    const g = this.gainsRef();
    const pos = world.rigidBody.position;
    const vel = world.rigidBody.velocity;
    // Aim biased away from the tower truss (see DOCK_APPROACH_X_BIAS_M);
    // still inside the capture volume, so the catch registers there.
    const aimX = this.targetPosition.x + DOCK_APPROACH_X_BIAS_M;
    const aimZ = this.targetPosition.z;
    const dy = pos.y - this.targetPosition.y;
    const latErr = Math.hypot(aimX - pos.x, aimZ - pos.z);
    const latSpeed = Math.hypot(vel.x, vel.z);
    const hoverable =
      this.minThrustN <= HOVER_MARGIN * G_MPS2 * world.rigidBody.mass;
    const vyTarget = dockVerticalTarget(dy, latErr, latSpeed, hoverable);
    // Float pulses (see DOCK_FLOAT_BAND_MPS): the only way DOWN for a
    // stack the engine floor out-lifts. Hysteresis around the vy target.
    if (hoverable) {
      this.floating = false;
    } else if (this.floating) {
      if (vel.y < vyTarget - DOCK_FLOAT_BAND_MPS) this.floating = false;
    } else if (vel.y > vyTarget + DOCK_FLOAT_BAND_MPS) {
      this.floating = true;
    }
    const ax = clamp(
      DOCK_LAT_KP * (aimX - pos.x) - DOCK_LAT_KD * vel.x,
      -DOCK_LAT_ACC_MAX,
      DOCK_LAT_ACC_MAX,
    );
    const az = clamp(
      DOCK_LAT_KP * (aimZ - pos.z) - DOCK_LAT_KD * vel.z,
      -DOCK_LAT_ACC_MAX,
      DOCK_LAT_ACC_MAX,
    );
    const ay = G_MPS2 + clamp(0.9 * (vyTarget - vel.y), -6, 28);
    const aCmd = Vec3.of(ax, ay, az);
    const aMag = Vec3.length(aCmd);
    const throttle = this.floating
      ? { centre: 0, inner: 0, outer: 0, ship: 0 }
      : this.allocateForThrust(
          Math.max(aMag * world.rigidBody.mass, this.minThrustN),
        );
    const enginesOn: EngineGroupBag<boolean> = {
      centre: throttle.centre > 0,
      inner: throttle.inner > 0,
      outer: throttle.outer > 0,
      ship: throttle.ship > 0,
    };
    const dir = aMag > 1e-6 ? Vec3.scale(aCmd, 1 / aMag) : Vec3.of(0, 1, 0);
    // Slew-limited tilt setpoints (see DOCK_TILT_SLEW_RAD_PER_S and the
    // far/near regimes): the attitude loop is never asked to chase a
    // command reversing faster than its own lag.
    const far =
      latErr > DOCK_FAR_LAT_ERR_M || latSpeed > DOCK_FAR_LAT_SPEED_MPS;
    const tiltCap = far ? DOCK_TILT_MAX_FAR_RAD : DOCK_TILT_MAX_RAD;
    const wantX = clamp(dir.x, -tiltCap, tiltCap);
    const wantZ = clamp(dir.z, -tiltCap, tiltCap);
    const slew =
      (far ? DOCK_TILT_SLEW_FAR_RAD_PER_S : DOCK_TILT_SLEW_RAD_PER_S) * dt;
    this.dockTiltX += clamp(wantX - this.dockTiltX, -slew, slew);
    this.dockTiltZ += clamp(wantZ - this.dockTiltZ, -slew, slew);
    const bodyUpWorld = Quat.rotateVec3(
      world.rigidBody.attitude,
      Vec3.of(0, 1, 0),
    );
    this.attPidPitch.gains = g.attitudePitch;
    this.attPidYaw.gains = g.attitudeYaw;
    const cmds = attitudeCommands(
      bodyUpWorld,
      this.dockTiltX,
      this.dockTiltZ,
      world.rigidBody.angularVelocity,
      this.attPidPitch,
      this.attPidYaw,
      dt,
      this.maxGimbalRad,
      DOCK_RATE_DAMP,
    );
    const base = neutralControl(this.finCount, this.flapCount);
    return {
      ...base,
      engineGroups: throttle,
      enginesOn,
      gimbalPitch: cmds.pitch,
      gimbalYaw: cmds.yaw,
      fins: mixFins(cmds.pitch, cmds.yaw).slice(0, this.finCount),
      flaps: new Array(this.flapCount).fill(0) as number[],
    };
  }

  /**
   * Predicted ballistic impact error (SLS-49): forward-roll the world
   * engines-off (fins deployed, no wind assumed) to the catch altitude
   * and compare the impact point against the aim point. Coarse dt is
   * plenty — the steering loop only needs the error to tens of metres,
   * and prediction bias is absorbed by feedback.
   */
  private predictImpactError(world: World): { x: number; z: number } {
    const ctl: ControlInput = neutralControl(this.finCount, this.flapCount);
    let w = world;
    const dt = 0.25;
    const floorY = this.targetPosition.y;
    for (let i = 0; i < 1600 && w.rigidBody.position.y > floorY; i++) {
      w = simStep(w, this.vehicle, ctl, dt, this.rolloutEnv);
    }
    return {
      x: w.rigidBody.position.x - this.targetPosition.x,
      z: w.rigidBody.position.z - this.targetPosition.z,
    };
  }

  /**
   * Floor-aware engine allocation for a desired TOTAL thrust in newtons.
   *
   * The plant clamps every lit engine to its throttle floor (40 %), so
   * the deliverable band of an engine set is [Σ floor·T, Σ T] — bands
   * for successive sets overlap or gap, they are not proportional. Pick
   * the smallest activation-order prefix whose band can reach the
   * demand; when the demand falls in the gap between "previous set at
   * max" and "next set at floor", pick whichever endpoint is closer.
   * All lit groups run one shared throttle value.
   */
  private allocateForThrust(desiredN: number): EngineGroupBag<number> {
    const off: EngineGroupBag<number> = {
      centre: 0,
      inner: 0,
      outer: 0,
      ship: 0,
    };
    if (desiredN <= 0 || this.thrustGroups.length === 0) return off;

    let bestCount = this.thrustGroups.length;
    let cumMax = 0;
    let cumMin = 0;
    let prevMax = 0;
    for (let i = 0; i < this.thrustGroups.length; i++) {
      cumMax += this.thrustGroups[i]!.maxN;
      cumMin += this.thrustGroups[i]!.minN;
      if (desiredN <= cumMax) {
        // Reachable with this prefix — unless we sit in the dead band
        // below its floor and the previous prefix's max is closer.
        bestCount =
          desiredN < cumMin && prevMax > 0
            ? Math.abs(desiredN - prevMax) <= Math.abs(desiredN - cumMin)
              ? i
              : i + 1
            : i + 1;
        break;
      }
      prevMax = cumMax;
    }

    let setMax = 0;
    for (let i = 0; i < bestCount; i++) setMax += this.thrustGroups[i]!.maxN;
    if (setMax <= 0) return off;
    // Shared throttle across the lit set; the plant enforces the floor.
    const tau = clamp(desiredN / setMax, 0, 1);
    const out = { ...off };
    for (let i = 0; i < bestCount; i++) {
      out[this.thrustGroups[i]!.group] = tau;
    }
    return out;
  }
}
