/**
 * Cascaded-PID flight controller.
 *
 * Loop layout (ticket SLS-23):
 *  Outer altitude PID    — vy tracking → total throttle [0..1]
 *  Outer horizontal PID  — world (x,z) position → desired tilt vector
 *  Inner attitude PID    — tilt error → gimbal pitch / yaw command
 *
 * The "rate" inner loop folds into the attitude PID's derivative-on-
 * measurement term (which IS the body-frame angular-rate signal at small
 * angles). Documented in ADR-006 — the 4-layer split the ticket sketches
 * is overkill for a baseline that is explicitly meant to "fail at the hard
 * cases" (per ticket notes).
 *
 * Frame conventions (verified against integrator.ts):
 *  - position, velocity   — world frame; +Y up
 *  - angularVelocity      — body frame
 *  - body +Y is the rocket's long axis (nose)
 *  - bodyUp_world = Quat.rotateVec3(attitude, [0,1,0])
 *
 * Engine plant: 33 Raptors @ ~2.05 MN each → ~67.6 MN max. Only the 3
 * centre engines gimbal (±0.35 rad clamp). Group activation ramps the
 * outer ring last so partial-throttle commands map to a sensible engine
 * count.
 */

import {
  Quat,
  Vec3,
  neutralControl,
  type ControlInput,
  type EngineGroup,
  type EngineGroupBag,
  type Vehicle,
  type World,
} from "@starship-catch-sim/physics";

import { PID, type PIDGains } from "./pid.js";
import type { Controller } from "./types.js";

/**
 * All gains for the cascaded controller. Stored as a flat record so the
 * tuning panel can drive every knob via a single Zustand slice.
 */
export type PIDControllerGains = {
  altitude: PIDGains;
  horizontalX: PIDGains;
  horizontalZ: PIDGains;
  attitudePitch: PIDGains;
  attitudeYaw: PIDGains;
  /** Vertical-speed profile constant in
   *  `vy_setpoint = -k · √(h − finalApproachAltitudeM)` (above the final-
   *  approach window; below it the setpoint ramps linearly to 0). */
  descentProfileK: number;
  /** Final-approach altitude (m above tower catch-point) where the profile
   *  flattens to a constant slow descent. */
  finalApproachAltitudeM: number;
  /** Slow final-approach descent rate (m/s). */
  finalApproachVyMps: number;
  /** Maximum tilt the horizontal PID is allowed to command (rad). */
  maxTiltRad: number;
  /** Altitude above tower (m) at which engines ignite for the descent burn. */
  ignitionAltitudeM: number;
  /** Roll rate-SAS gain: grid fins deflected to oppose the body ROLL rate
   *  (about the long axis) — the ONLY actuator with roll authority (a single
   *  gimbaled engine makes no torque about the thrust axis). The old constant
   *  uniform-fin deploy commanded a steady roll the gimbal can't counter,
   *  spinning the booster to ~900°/s until it tumbled; this nulls it and keeps
   *  the max body rate ~60°/s so the baseline misses gracefully (SLS-77). */
  finRollDampGain: number;
};

/**
 * Default gains, hand-tuned against `BoosterDescentCalm` to give the
 * baseline a fighting chance. PID-only is not expected to be reliable
 * here — the headline plot is "PID struggles, MPC works". See ADR-006.
 */
export const DEFAULT_PID_GAINS: PIDControllerGains = {
  altitude: {
    kp: 0.08,
    ki: 0.005,
    kd: 0.02,
    outputClamp: [0, 1],
    integralClamp: [-0.5, 0.5],
    derivativeFilterTau: 0.2,
    kAw: 0.05,
  },
  horizontalX: {
    kp: 0.004,
    ki: 0.00002,
    kd: 0.02,
    outputClamp: [-0.3, 0.3],
    integralClamp: [-0.1, 0.1],
    derivativeFilterTau: 0.3,
    kAw: 0.05,
  },
  horizontalZ: {
    kp: 0.004,
    ki: 0.00002,
    kd: 0.02,
    outputClamp: [-0.3, 0.3],
    integralClamp: [-0.1, 0.1],
    derivativeFilterTau: 0.3,
    kAw: 0.05,
  },
  attitudePitch: {
    kp: 2.5,
    ki: 0.1,
    kd: 0.4,
    outputClamp: [-0.3, 0.3],
    integralClamp: [-0.1, 0.1],
    derivativeFilterTau: 0.1,
    kAw: 0.04,
  },
  attitudeYaw: {
    kp: 2.5,
    ki: 0.1,
    kd: 0.4,
    outputClamp: [-0.3, 0.3],
    integralClamp: [-0.1, 0.1],
    derivativeFilterTau: 0.1,
    kAw: 0.04,
  },
  descentProfileK: 8.0,
  finalApproachAltitudeM: 250,
  finalApproachVyMps: -8,
  ignitionAltitudeM: 60_000,
  maxTiltRad: 0.3,
  finRollDampGain: 2.5,
};

/**
 * Snapshot of every PID's last (setpoint, measurement, command) — fed to
 * the UI store so the tuning panel can chart the loops live.
 */
export type PIDDebugFrame = {
  t: number;
  altitude: { setpoint: number; measurement: number; command: number };
  horizontalX: { setpoint: number; measurement: number; command: number };
  horizontalZ: { setpoint: number; measurement: number; command: number };
  attitudePitch: { setpoint: number; measurement: number; command: number };
  attitudeYaw: { setpoint: number; measurement: number; command: number };
};

/** Optional observer the UI plugs in to receive a frame each tick. */
export type PIDObserver = (frame: PIDDebugFrame) => void;

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

export class PIDController implements Controller {
  private readonly finCount: number;
  private readonly flapCount: number;
  private readonly maxGimbalRad: number;
  private readonly maxFinDeflRad: number;
  /**
   * Distinct engine groups this vehicle actually exposes (SLS-81). The
   * booster splits its 33 Raptors into centre/inner/outer; the Starship
   * upper stage runs all its Raptors as one `ship` group. Throttle
   * allocation routes to whichever groups exist — commanding a group the
   * vehicle lacks was a silent no-op (the ship never ignited).
   */
  private readonly engineGroups: ReadonlySet<EngineGroup>;
  private readonly targetPosition: Vec3;
  private readonly altPid: PID;
  private readonly horizPidX: PID;
  private readonly horizPidZ: PID;
  private readonly attPidPitch: PID;
  private readonly attPidYaw: PID;
  /** Read-on-step gain bag so panel sliders are felt live (no reset). */
  private gainsRef: () => PIDControllerGains;
  private observer: PIDObserver | null = null;

  constructor(
    vehicle: Vehicle,
    targetPosition: Vec3,
    gainsRef: () => PIDControllerGains,
  ) {
    this.finCount = vehicle.surfaces.filter((s) => s.kind === "grid_fin").length;
    this.flapCount = vehicle.surfaces.filter((s) => s.kind === "flap").length;
    this.engineGroups = new Set(vehicle.engineGroupOf);
    // Plant gimbal limit (±0.262 rad for Raptor) — pre-clamping at the
    // real saturation point keeps the attitude PIDs' anti-windup honest.
    // (An earlier hardcoded ±0.35 was the gimbal RATE, not the angle.)
    this.maxGimbalRad = vehicle.engines.reduce(
      (m, e) => Math.max(m, e.maxGimbal),
      0,
    );
    // Plant grid-fin deflection limit, so the roll-damper command saturates
    // exactly where the fin does (not a hand-picked ±0.35 that overshoots it).
    this.maxFinDeflRad = vehicle.surfaces.reduce(
      (m, s) => (s.kind === "grid_fin" ? Math.max(m, s.maxDeflection) : m),
      0,
    );
    this.targetPosition = targetPosition;
    this.gainsRef = gainsRef;
    const g = gainsRef();
    this.altPid = new PID(g.altitude);
    this.horizPidX = new PID(g.horizontalX);
    this.horizPidZ = new PID(g.horizontalZ);
    this.attPidPitch = new PID(g.attitudePitch);
    this.attPidYaw = new PID(g.attitudeYaw);
  }

  setObserver(observer: PIDObserver | null): void {
    this.observer = observer;
  }

  reset(): void {
    this.altPid.reset();
    this.horizPidX.reset();
    this.horizPidZ.reset();
    this.attPidPitch.reset();
    this.attPidYaw.reset();
  }

  step(world: World, dt: number): ControlInput {
    const g = this.gainsRef();
    // Refresh PID gains every tick so the slider panel is felt live.
    this.altPid.gains = g.altitude;
    this.horizPidX.gains = g.horizontalX;
    this.horizPidZ.gains = g.horizontalZ;
    this.attPidPitch.gains = g.attitudePitch;
    this.attPidYaw.gains = g.attitudeYaw;

    const pos = world.rigidBody.position;
    const vel = world.rigidBody.velocity;
    const target = this.targetPosition;
    const heightAboveTarget = pos.y - target.y;

    // --- Outer altitude: vy-profile tracking ---
    const vySetpoint = this.computeVySetpoint(heightAboveTarget, g);
    const altCmd = this.altPid.update(vySetpoint, vel.y, dt);

    // --- Engine on/off + group throttle allocation ---
    const enginesShouldFire = heightAboveTarget <= g.ignitionAltitudeM;
    const throttle = this.allocateThrottle(altCmd, enginesShouldFire);
    const enginesOn: EngineGroupBag<boolean> = {
      centre: enginesShouldFire && throttle.centre > 0,
      inner: enginesShouldFire && throttle.inner > 0,
      outer: enginesShouldFire && throttle.outer > 0,
      ship: enginesShouldFire && throttle.ship > 0,
    };

    // --- Outer horizontal: world position → desired body-up tilt vector ---
    // Positive bodyUp.x means thrust pushes +X. To translate toward
    // target.x (i.e. when pos.x > target.x, we want -X push), we need
    // bodyUp.x < 0. The error sign is (target - measurement); kp positive
    // makes that work directly.
    const tiltSetpointX = clamp(
      this.horizPidX.update(target.x, pos.x, dt),
      -g.maxTiltRad,
      g.maxTiltRad,
    );
    const tiltSetpointZ = clamp(
      this.horizPidZ.update(target.z, pos.z, dt),
      -g.maxTiltRad,
      g.maxTiltRad,
    );

    // --- Inner attitude: bodyUp tilt-vector tracking ---
    const bodyUpWorld = Quat.rotateVec3(world.rigidBody.attitude, Vec3.of(0, 1, 0));
    // bodyUp_world.x and .z are the horizontal tilt components.
    // Map to gimbal: gimbal pitch torques body about body +X, which changes
    // bodyUp's projection onto body +Z (≈ world +Z near upright). So:
    //   gimbalPitch ← attPidPitch on (tiltSetpointZ - bodyUp.z)
    //   gimbalYaw   ← attPidYaw   on (tiltSetpointX - bodyUp.x)
    // (Sign details verified empirically via the tuning panel.)
    const gimbalPitchCmd = this.attPidPitch.update(
      tiltSetpointZ,
      bodyUpWorld.z,
      dt,
    );
    const gimbalYawCmd = this.attPidYaw.update(tiltSetpointX, bodyUpWorld.x, dt);

    // Pre-clamp at the plant's actual gimbal limit so anti-windup
    // unwinds exactly where the engine saturates.
    const gimbalPitch = clamp(
      gimbalPitchCmd,
      -this.maxGimbalRad,
      this.maxGimbalRad,
    );
    const gimbalYaw = clamp(gimbalYawCmd, -this.maxGimbalRad, this.maxGimbalRad);

    const observer = this.observer;
    if (observer !== null) {
      observer({
        t: world.t,
        altitude: { setpoint: vySetpoint, measurement: vel.y, command: altCmd },
        horizontalX: {
          setpoint: target.x,
          measurement: pos.x,
          command: tiltSetpointX,
        },
        horizontalZ: {
          setpoint: target.z,
          measurement: pos.z,
          command: tiltSetpointZ,
        },
        attitudePitch: {
          setpoint: tiltSetpointZ,
          measurement: bodyUpWorld.z,
          command: gimbalPitch,
        },
        attitudeYaw: {
          setpoint: tiltSetpointX,
          measurement: bodyUpWorld.x,
          command: gimbalYaw,
        },
      });
    }

    // Grid fins as a ROLL-RATE damper (SLS-77). Uniform fin deflection makes a
    // roll torque about the long axis (the fins share a tangential swirl
    // normal), so the old constant 0.25 deploy commanded a steady roll the
    // gimbal can't counter — spinning the booster to ~900°/s. Instead deflect
    // to oppose the measured roll rate, only where the air is dense enough for
    // the fins to bite (below 50 km).
    const rollRate = world.rigidBody.angularVelocity.y; // body roll rate
    const finRollCmd =
      heightAboveTarget < 50_000
        ? clamp(
            -g.finRollDampGain * rollRate,
            -this.maxFinDeflRad,
            this.maxFinDeflRad,
          )
        : 0;

    const base = neutralControl(this.finCount, this.flapCount);
    return {
      ...base,
      engineGroups: throttle,
      enginesOn,
      gimbalPitch,
      gimbalYaw,
      fins: new Array(this.finCount).fill(finRollCmd),
      flaps: new Array(this.flapCount).fill(0),
    };
  }

  /**
   * Descent profile: -k·sqrt(h) above the final-approach window, then a
   * constant slow descent. This is the classic "suicide burn" terminal
   * trajectory expressed as a vy setpoint a feedback PID can track.
   */
  private computeVySetpoint(h: number, g: PIDControllerGains): number {
    if (h <= 0) return 0;
    if (h < g.finalApproachAltitudeM) {
      // Linear blend from finalApproach rate at finalApproachAltitudeM down
      // to 0 at h=0 → enables soft touchdown.
      const t = h / g.finalApproachAltitudeM;
      return g.finalApproachVyMps * t;
    }
    return -g.descentProfileK * Math.sqrt(h - g.finalApproachAltitudeM);
  }

  /**
   * Map a [0..1] total-thrust command onto the vehicle's engine groups
   * (SLS-81). A booster ramps its three groups in a vehicle-plausible
   * order: centre first (always available), inner ring joining at cmd 0.2,
   * outer ring at cmd 0.5. The Starship upper stage runs all its Raptors as
   * a single `ship` group, so the command drives that group directly —
   * commanding centre/inner/outer on a ship was a silent no-op that left it
   * unpowered.
   */
  private allocateThrottle(
    cmd: number,
    fire: boolean,
  ): EngineGroupBag<number> {
    if (!fire || cmd <= 0) {
      return { centre: 0, inner: 0, outer: 0, ship: 0 };
    }
    const x = clamp(cmd, 0, 1);
    // Single-group stage (e.g. Starship's `ship`): every engine ramps
    // together, driving whichever group the vehicle actually exposes. Keying
    // on cardinality — not a hardcoded `ship` — means any future single-group
    // stage ignites instead of silently commanding groups it lacks (the
    // SLS-81 bug).
    if (this.engineGroups.size === 1) {
      const [only] = this.engineGroups;
      return { centre: 0, inner: 0, outer: 0, ship: 0, [only!]: x };
    }
    // Centre ramps 5× (saturating at cmd 0.2) before the inner ring
    // joins — mirrors the real Raptor activation ladder.
    const centre = clamp(x * 5, 0, 1);
    const inner = clamp((x - 0.2) * 2.5, 0, 1);
    const outer = clamp((x - 0.5) * 2, 0, 1);
    return { centre, inner, outer, ship: 0 };
  }
}
