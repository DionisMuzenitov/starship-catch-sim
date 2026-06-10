/**
 * Pure derivations from the simulator's `World` state for the telemetry
 * HUD. Everything in here is read-only and side-effect-free — easy to
 * unit-test, easy to reuse in MPC / RL diagnostics later.
 *
 * Air model for Mach: simple ISA tropospheric lapse to 11 km, then a
 * constant stratospheric temperature. Display-only — proper
 * Mach-dependent drag lands in SLS-45.
 */

import {
  Vec3,
  neutralControl,
  simStep,
  tankCapacity,
  type EngineGroup,
  type Vehicle,
  type World,
} from "@starship-catch-sim/physics";

/** Heat capacity ratio for air. */
const GAMMA = 1.4;
/** Specific gas constant for dry air (J / (kg K)). */
const R_AIR = 287;

/** ISA temperature at altitude (K). Tropospheric lapse capped at 11 km. */
export function isaTemperatureK(altitudeM: number): number {
  const T = 288.15 - 0.0065 * altitudeM;
  return Math.max(216.65, T);
}

/** Speed of sound (m/s) at altitude using ISA T(h). */
export function speedOfSound(altitudeM: number): number {
  return Math.sqrt(GAMMA * R_AIR * isaTemperatureK(altitudeM));
}

/** Mach number = |v| / c(h). */
export function machNumber(world: World): number {
  const v = Vec3.length(world.rigidBody.velocity);
  const c = speedOfSound(world.rigidBody.position.y);
  return c > 0 ? v / c : 0;
}

/** Vertical (Y) speed component, signed (m/s). +y up. */
export function verticalSpeed(world: World): number {
  return world.rigidBody.velocity.y;
}

/** Horizontal speed magnitude in the X/Z plane (m/s). */
export function horizontalSpeed(world: World): number {
  const v = world.rigidBody.velocity;
  return Math.hypot(v.x, v.z);
}

/** Total speed magnitude (m/s). */
export function groundSpeed(world: World): number {
  return Vec3.length(world.rigidBody.velocity);
}

export type EulerAngles = {
  /** Rotation about body X (rad). Positive = nose up. */
  pitch: number;
  /** Rotation about body Z (rad). Positive = right-wing-down (per convention). */
  roll: number;
  /** Rotation about body Y (rad). Compass heading. */
  yaw: number;
};

/**
 * Tait-Bryan ZYX intrinsic from quaternion. At pitch = ±π/2 the yaw/roll
 * decomposition degenerates (gimbal lock) — rare for booster ops.
 */
export function attitudeAngles(world: World): EulerAngles {
  const { x, y, z, w } = world.rigidBody.attitude;
  const clamp = (v: number, lo: number, hi: number) =>
    v < lo ? lo : v > hi ? hi : v;
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const pitch = Math.asin(clamp(2 * (w * y - z * x), -1, 1));
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return { pitch, roll, yaw };
}

/** Index ranges of each engine group in `SuperHeavyEngines`-style vehicles. */
function groupIndices(vehicle: Vehicle, group: EngineGroup): number[] {
  const out: number[] = [];
  for (let i = 0; i < vehicle.engineGroupOf.length; i++) {
    if (vehicle.engineGroupOf[i] === group) out.push(i);
  }
  return out;
}

/** Mean realised throttle of all engines in a group (0 if empty). */
export function groupThrottle(
  world: World,
  vehicle: Vehicle,
  group: EngineGroup,
): number {
  const idx = groupIndices(vehicle, group);
  if (idx.length === 0) return 0;
  let sum = 0;
  for (const i of idx) sum += world.engineStates[i]!.throttle;
  return sum / idx.length;
}

/** True if any engine in the group is currently on. */
export function groupAnyOn(
  world: World,
  vehicle: Vehicle,
  group: EngineGroup,
): boolean {
  const idx = groupIndices(vehicle, group);
  for (const i of idx) if (world.engineStates[i]!.on) return true;
  return false;
}

/** Propellant mass remaining (kg). */
export function propellantMass(world: World): number {
  return world.mass.propellantMass;
}

/** Fraction of tank capacity remaining, [0, 1]. */
export function fuelFraction(world: World): number {
  const cap = tankCapacity(world.mass);
  if (cap <= 0) return 0;
  return world.mass.propellantMass / cap;
}

/** Mechazilla tower base is at world origin in our coordinate system. */
const TOWER_BASE = Vec3.of(0, 0, 0);

export type TowerProximity = {
  /** 3D Euclidean distance from rocket CoM to tower base (m). */
  dist3d: number;
  /** Horizontal (X/Z) distance only (m). */
  distHoriz: number;
  /** Compass bearing from tower toward rocket (rad). 0 = +X (east). */
  bearingRad: number;
};

export function towerProximity(world: World): TowerProximity {
  const r = world.rigidBody.position;
  const dx = r.x - TOWER_BASE.x;
  const dz = r.z - TOWER_BASE.z;
  return {
    dist3d: Vec3.length(Vec3.sub(r, TOWER_BASE)),
    distHoriz: Math.hypot(dx, dz),
    bearingRad: Math.atan2(dz, dx),
  };
}

export type ImpactPredictionOpts = {
  /** Forward-roll dt (s). Default 0.05 s. */
  dt?: number;
  /** Cap on forward simulated time (s). Default 60 s. */
  maxT?: number;
  /** Ground plane Y in world frame (m). Default 0. */
  groundY?: number;
};

/**
 * Forward-roll the world with engines off until it crosses the ground
 * plane. Returns the world-frame impact point, or `null` if the rocket
 * doesn't reach the ground within `maxT`.
 *
 * Uses the canonical `simStep` orchestrator so the prediction includes
 * gravity + body drag — the "ballistic + drag" projection from the
 * ticket. Thrust prediction is intentionally absent (that's MPC's job).
 *
 * Cost: at the default 50 ms × 60 s budget ⇒ 1,200 simSteps per call.
 * Callers should rate-limit (recompute at ~5 Hz, not 60 Hz).
 */
export function predictedImpact(
  world: World,
  vehicle: Vehicle,
  opts: ImpactPredictionOpts = {},
): Vec3 | null {
  const dt = opts.dt ?? 0.05;
  const maxT = opts.maxT ?? 60;
  const groundY = opts.groundY ?? 0;
  if (world.rigidBody.position.y <= groundY) return world.rigidBody.position;

  const ctl = neutralControl(
    vehicle.surfaces.filter((s) => s.kind === "grid_fin").length,
    vehicle.surfaces.filter((s) => s.kind === "flap").length,
  );
  let prev = world;
  let elapsed = 0;
  while (elapsed < maxT) {
    const next = simStep(prev, vehicle, ctl, dt);
    if (next.rigidBody.position.y <= groundY) {
      // Linear interpolation of the ground crossing in the last segment.
      const y0 = prev.rigidBody.position.y;
      const y1 = next.rigidBody.position.y;
      const alpha = y0 === y1 ? 0 : (y0 - groundY) / (y0 - y1);
      const a = prev.rigidBody.position;
      const b = next.rigidBody.position;
      return Vec3.of(
        a.x + (b.x - a.x) * alpha,
        groundY,
        a.z + (b.z - a.z) * alpha,
      );
    }
    prev = next;
    elapsed += dt;
  }
  return null;
}

/** Convenience: a clamped (0..1) fraction of the booster's max gimbal. */
export function meanGimbalAngles(world: World): { pitch: number; yaw: number } {
  let p = 0;
  let y = 0;
  let n = 0;
  for (const e of world.engineStates) {
    if (e.gimbalPitch === 0 && e.gimbalYaw === 0) continue;
    p += e.gimbalPitch;
    y += e.gimbalYaw;
    n++;
  }
  if (n === 0) return { pitch: 0, yaw: 0 };
  return { pitch: p / n, yaw: y / n };
}

