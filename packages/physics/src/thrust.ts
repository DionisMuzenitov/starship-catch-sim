/**
 * Multi-engine, gimbaled, throttle-controlled thrust plant.
 *
 * Each engine has a body-frame mount, a nominal thrust direction, a 2-axis
 * gimbal (pitch around body X, yaw around body Z), throttle range, response
 * delays, and a mass flow rate that depends on the realised thrust.
 *
 * Aggregated outputs are returned in the body frame so the caller can either
 * apply torques directly (body frame, as the integrator expects) or rotate
 * the force through the attitude quaternion to get world-frame force.
 *
 * Per ADR-004 this module imports only local math. Per the body-frame
 * convention from `mass.ts`, +y points up the rocket.
 */

import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";

/** Standard gravity used in the definition of specific impulse. */
export const G0 = 9.80665;

export type Engine = {
  /** Engine attachment point in body frame (m). */
  readonly mount: Vec3;
  /**
   * Force direction on the body in body frame, unit vector, when the engine
   * is firing at full throttle with zero gimbal. For a rocket engine that
   * pushes the vehicle "up" along its +y body axis, this is `(0, +1, 0)` —
   * the *direction the body accelerates*, not the direction exhaust leaves.
   */
  readonly direction: Vec3;
  readonly thrustVac: number; // N — thrust in vacuum
  readonly thrustSea: number; // N — thrust at sea-level pressure
  readonly ispVac: number; // s — specific impulse in vacuum
  readonly ispSea: number; // s — specific impulse at sea level
  /** Maximum gimbal angle (rad) from nominal direction, per axis. */
  readonly maxGimbal: number;
  /** Maximum gimbal slew rate (rad/s). */
  readonly maxGimbalRate: number;
  /** Lower throttle bound when the engine is on (0..1]. */
  readonly minThrottle: number;
  /** First-order lag time constant for throttle response (s). */
  readonly tauThrottle: number;
  /** First-order lag time constant for gimbal angle response (s). */
  readonly tauGimbal: number;
  /** Whether the engine can gimbal at all (fixed engines ignore commands). */
  readonly canGimbal: boolean;
};

export type EngineState = {
  /** Realised gimbal pitch angle (rad), about body X. */
  readonly gimbalPitch: number;
  /** Realised gimbal yaw angle (rad), about body Z. */
  readonly gimbalYaw: number;
  /** Realised throttle in [0, 1]. Below `minThrottle` only when shutting down. */
  readonly throttle: number;
  /** Ignition state. False → throttle ramps to 0. */
  readonly on: boolean;
};

export type EngineCommand = {
  readonly gimbalPitchTarget: number;
  readonly gimbalYawTarget: number;
  /** Target throttle. Clamped to [minThrottle, 1] when `on`; ignored when off. */
  readonly throttleTarget: number;
  readonly on: boolean;
};

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

/** First-order exponential lag: x → target with time constant τ over dt. */
function lagFirstOrder(
  current: number,
  target: number,
  tau: number,
  dt: number,
): number {
  if (tau <= 0) return target;
  const alpha = 1 - Math.exp(-dt / tau);
  return current + (target - current) * alpha;
}

/**
 * Advance one engine's actuator state by `dt`. Applies first-order lag on
 * throttle and gimbal, plus a slew-rate cap on gimbal angles, plus the
 * configured throttle and gimbal-angle limits.
 */
export function updateEngineState(
  engine: Engine,
  state: EngineState,
  command: EngineCommand,
  dt: number,
): EngineState {
  // Throttle target: clamp to [minThrottle, 1] when on, else 0.
  const throttleTarget = command.on
    ? clamp(command.throttleTarget, engine.minThrottle, 1)
    : 0;
  const nextThrottle = lagFirstOrder(
    state.throttle,
    throttleTarget,
    engine.tauThrottle,
    dt,
  );

  // Gimbal targets: zero for fixed engines, otherwise clamp to ±maxGimbal.
  const pitchTarget = engine.canGimbal
    ? clamp(command.gimbalPitchTarget, -engine.maxGimbal, engine.maxGimbal)
    : 0;
  const yawTarget = engine.canGimbal
    ? clamp(command.gimbalYawTarget, -engine.maxGimbal, engine.maxGimbal)
    : 0;

  // Lag then rate-limit each gimbal axis.
  const maxStep = engine.maxGimbalRate * dt;
  const pitchLagged = lagFirstOrder(
    state.gimbalPitch,
    pitchTarget,
    engine.tauGimbal,
    dt,
  );
  const pitchDelta = clamp(pitchLagged - state.gimbalPitch, -maxStep, maxStep);
  const yawLagged = lagFirstOrder(
    state.gimbalYaw,
    yawTarget,
    engine.tauGimbal,
    dt,
  );
  const yawDelta = clamp(yawLagged - state.gimbalYaw, -maxStep, maxStep);

  return {
    gimbalPitch: state.gimbalPitch + pitchDelta,
    gimbalYaw: state.gimbalYaw + yawDelta,
    throttle: nextThrottle,
    on: command.on,
  };
}

/** Atmosphere-aware thrust magnitude. */
function thrustAtPressure(engine: Engine, pressureRatio: number): number {
  const pr = clamp(pressureRatio, 0, 1);
  return engine.thrustVac - (engine.thrustVac - engine.thrustSea) * pr;
}

function ispAtPressure(engine: Engine, pressureRatio: number): number {
  const pr = clamp(pressureRatio, 0, 1);
  return engine.ispVac - (engine.ispVac - engine.ispSea) * pr;
}

/**
 * Body-frame thrust direction after applying the gimbal: rotate
 * `engine.direction` first around body X by `gimbalPitch`, then around body
 * Z by `gimbalYaw`. Uses exact quaternion rotation, not the small-angle
 * approximation, since the cost is negligible.
 */
function gimbalDirection(engine: Engine, state: EngineState): Vec3 {
  const qPitch = Quat.fromAxisAngle(Vec3.of(1, 0, 0), state.gimbalPitch);
  const qYaw = Quat.fromAxisAngle(Vec3.of(0, 0, 1), state.gimbalYaw);
  const q = Quat.multiply(qYaw, qPitch);
  return Quat.rotateVec3(q, engine.direction);
}

export type EngineContribution = {
  /** Thrust vector in body frame (N). */
  readonly forceBody: Vec3;
  /** Moment about the body's current CoM in body frame (N·m). */
  readonly torqueBody: Vec3;
  /** Mass flow rate consumed by this engine (kg/s). */
  readonly mdot: number;
};

/**
 * Compute the force, torque, and mass flow contributed by a single engine,
 * given its current actuator state and the local pressure ratio.
 */
export function engineForceTorque(
  engine: Engine,
  state: EngineState,
  comBody: Vec3,
  pressureRatio: number,
): EngineContribution {
  const thrustMag = state.throttle * thrustAtPressure(engine, pressureRatio);
  if (thrustMag <= 0) {
    return { forceBody: Vec3.ZERO, torqueBody: Vec3.ZERO, mdot: 0 };
  }
  const dir = gimbalDirection(engine, state);
  const forceBody = Vec3.scale(dir, thrustMag);
  const arm = Vec3.sub(engine.mount, comBody);
  const torqueBody = Vec3.cross(arm, forceBody);
  const isp = ispAtPressure(engine, pressureRatio);
  const mdot = isp > 0 ? thrustMag / (isp * G0) : 0;
  return { forceBody, torqueBody, mdot };
}

export type PlantOutput = {
  readonly forceBody: Vec3;
  readonly torqueBody: Vec3;
  readonly mdotTotal: number;
  readonly newStates: readonly EngineState[];
};

/**
 * Advance the actuator state of every engine and compute the aggregated
 * force, torque, and mass flow. The returned `newStates` array is parallel
 * to the inputs.
 */
export function aggregate(
  engines: readonly Engine[],
  states: readonly EngineState[],
  commands: readonly EngineCommand[],
  comBody: Vec3,
  pressureRatio: number,
  dt: number,
): PlantOutput {
  if (
    engines.length !== states.length ||
    engines.length !== commands.length
  ) {
    throw new Error(
      `thrust.aggregate: array length mismatch — engines=${engines.length}, ` +
        `states=${states.length}, commands=${commands.length}`,
    );
  }

  let forceBody = Vec3.ZERO;
  let torqueBody = Vec3.ZERO;
  let mdotTotal = 0;
  const newStates: EngineState[] = new Array(engines.length);

  for (let i = 0; i < engines.length; i++) {
    const engine = engines[i]!;
    const state = states[i]!;
    const command = commands[i]!;
    const nextState = updateEngineState(engine, state, command, dt);
    newStates[i] = nextState;
    const c = engineForceTorque(engine, nextState, comBody, pressureRatio);
    forceBody = Vec3.add(forceBody, c.forceBody);
    torqueBody = Vec3.add(torqueBody, c.torqueBody);
    mdotTotal += c.mdot;
  }

  return { forceBody, torqueBody, mdotTotal, newStates };
}

/** Initial actuator state for an engine: shut down, gimbal centred. */
export function initialEngineState(): EngineState {
  return { gimbalPitch: 0, gimbalYaw: 0, throttle: 0, on: false };
}
