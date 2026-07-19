/**
 * Mechazilla tower geometry — pure data + pure functions shared between the
 * sim tick (catch detection) and the renderer (`<MechazillaTower>` scene
 * component). Kept here so a single source of truth drives both:
 *
 *  - `chopstickCatchPoints(state)` — the four world-space hard-points
 *    (left-fore, left-aft, right-fore, right-aft) where the gripper pads
 *    contact the rocket. Derived from the arm hinge positions + opening
 *    angle, matching the same arm-rotation convention the React component
 *    applies in `useFrame`.
 *
 *  - `chopstickCaptureVolume(state)` — the AABB covering the four catch
 *    points, expanded by a small vertical aperture so a moving rocket can
 *    be detected as "inside the capture region" on at least one tick.
 *    Shrinks linearly with `armOpeningT` (a wide-open chopstick can't catch
 *    a falling booster).
 *
 *  - `towerStructureAabb(state)` — bounding box for the trusses, used as the
 *    tower-collision check.
 *
 * Constants are extracted verbatim from the original
 * `MechazillaTower.tsx` so this module + the scene component stay numerically
 * in sync.
 */

import { Vec3 } from "./math/vec3.js";

export const TOWER_HEIGHT_M = 146;
/** Square base side length — leg corners sit on (±L/2, 0, ±L/2). */
export const TOWER_FOOTPRINT_M = 12;
/** Default carriage height (matches the real Mechazilla chopstick height). */
export const DEFAULT_ARM_HEIGHT_M = 91;
export const ARM_LENGTH_M = 30;
/** Distance from tower centreline to the chopstick hinge along +X. */
export const ARM_HINGE_OFFSET_X_M = TOWER_FOOTPRINT_M / 2 + 1.5;
/** ± offset from tower centreline along Z for the two arm hinges. */
export const ARM_HINGE_OFFSET_Z_M = 5;
/** Fore gripper pad offset from the hinge, along the arm's local +X. */
export const HARDPOINT_FORE_OFFSET_M = 4.5;
/** Aft gripper pad offset from the hinge (negative — sits behind the hinge). */
export const HARDPOINT_AFT_OFFSET_M = -2.5;
/** Maximum chopstick swing angle (0 = closed; this = wide open). */
export const ARM_ANGLE_OPEN_RAD = (110 * Math.PI) / 180;
/** Vertical aperture of the capture slot (full extent = 2× this). */
export const CAPTURE_VOLUME_Y_HALF_M = 4;

export type TowerState = {
  readonly basePosition: Vec3;
  /** 0 = arms closed (gripping pose), 1 = arms wide open. */
  readonly armOpeningT: number;
  /** Arm carriage Y position in world coords. */
  readonly armHeightM: number;
};

export const DEFAULT_TOWER_STATE: TowerState = {
  basePosition: Vec3.ZERO,
  armOpeningT: 0,
  armHeightM: DEFAULT_ARM_HEIGHT_M,
};

export type Aabb = {
  readonly center: Vec3;
  readonly halfExtents: Vec3;
};

/**
 * Booster collision capsule (ADR-020): a body-axis core segment (± halfLength
 * along body +Y from the CoM) swept by `radius`, rotating with the vehicle's
 * attitude. Used for structure-hit tests in `evaluateCatchOutcome`.
 */
export type BodyCapsule = {
  readonly radius: number;
  /** Half-length of the core segment along body +Y (≈ body half-length − radius). */
  readonly halfLength: number;
  /** Offset of the capsule centre from the CoM along body +Y (m). The GLB model
   *  origin sits at the base, not the CoM, so the collider is shifted up to sit
   *  on the drawn body (owner-tuned in `/sandbox/booster`). */
  readonly offset: number;
};

export type CaptureVolume = Aabb;

/**
 * Four catch hard-points in world coordinates, in the order
 * `[left-fore, left-aft, right-fore, right-aft]`. The "left" arm hinge sits at
 * `z = -ARM_HINGE_OFFSET_Z_M` and rotates by `+swing` about world +Y; the
 * "right" hinge sits at `z = +ARM_HINGE_OFFSET_Z_M` and rotates by `-swing`.
 * (This matches the sign convention `MechazillaTower.tsx` applies in
 * `useFrame`.) A rotation by θ about +Y sends local `(x, 0, 0)` to
 * `(x·cos θ, 0, -x·sin θ)`.
 */
export function chopstickCatchPoints(state: TowerState): readonly Vec3[] {
  const swing = ARM_ANGLE_OPEN_RAD * clamp01(state.armOpeningT);
  const points: Vec3[] = [];
  // sideSign matches MechazillaTower.tsx: side="left" → hingeZ = -5 (so
  // sideSign = -1); side="right" → hingeZ = +5 (sideSign = +1). The arm
  // rotation about +Y is `+swing` for left, `-swing` for right, i.e. the
  // sign is `-sideSign`.
  for (const sideSign of [-1, 1] as const) {
    const armRot = -sideSign * swing;
    const c = Math.cos(armRot);
    const s = Math.sin(armRot);
    const hingeX = state.basePosition.x + ARM_HINGE_OFFSET_X_M;
    const hingeZ = state.basePosition.z + sideSign * ARM_HINGE_OFFSET_Z_M;
    for (const offset of [HARDPOINT_FORE_OFFSET_M, HARDPOINT_AFT_OFFSET_M]) {
      points.push(
        Vec3.of(hingeX + c * offset, state.armHeightM, hingeZ - s * offset),
      );
    }
  }
  return points;
}

/**
 * Capture volume: an AABB centred between the closed-pose hard-points,
 * extended vertically by `CAPTURE_VOLUME_Y_HALF_M`. Slot dimensions are
 * fixed to the closed pose (so the player's spatial target is the same
 * regardless of arm angle); the volume shrinks linearly to zero as
 * `armOpeningT` → 1, so a wide-open chopstick can't catch anything.
 * `armOpeningT` is clamped to `[0, 1]`.
 */
export function chopstickCaptureVolume(state: TowerState): CaptureVolume {
  const closed: TowerState = { ...state, armOpeningT: 0 };
  const points = chopstickCatchPoints(closed);
  let xMin = Infinity;
  let xMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const p of points) {
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
    if (p.z < zMin) zMin = p.z;
    if (p.z > zMax) zMax = p.z;
  }
  const shrink = 1 - clamp01(state.armOpeningT);
  return {
    center: Vec3.of(
      (xMin + xMax) / 2,
      state.armHeightM,
      (zMin + zMax) / 2,
    ),
    halfExtents: Vec3.of(
      ((xMax - xMin) / 2) * shrink,
      CAPTURE_VOLUME_Y_HALF_M * shrink,
      ((zMax - zMin) / 2) * shrink,
    ),
  };
}

/**
 * Bounding box around the truss structure (legs + bracing). Centred on the
 * tower base, spans the full height. Used for tower-collision detection.
 */
export function towerStructureAabb(state: TowerState): Aabb {
  return {
    center: Vec3.of(
      state.basePosition.x,
      state.basePosition.y + TOWER_HEIGHT_M / 2,
      state.basePosition.z,
    ),
    halfExtents: Vec3.of(
      TOWER_FOOTPRINT_M / 2,
      TOWER_HEIGHT_M / 2,
      TOWER_FOOTPRINT_M / 2,
    ),
  };
}

export function pointInAabb(p: Vec3, aabb: Aabb): boolean {
  return (
    Math.abs(p.x - aabb.center.x) <= aabb.halfExtents.x &&
    Math.abs(p.y - aabb.center.y) <= aabb.halfExtents.y &&
    Math.abs(p.z - aabb.center.z) <= aabb.halfExtents.z
  );
}

function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}
