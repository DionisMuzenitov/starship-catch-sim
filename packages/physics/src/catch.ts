/**
 * Catch detection — pure outcome classifier called from the sim tick when
 * the rocket gets close enough to matter. Combines the existing
 * `evaluateCatch()` envelope check with the tower geometry primitives in
 * `tower.ts` to produce one of five outcomes:
 *
 *   - `caught`           — inside the capture volume AND envelope satisfied.
 *   - `near_miss`        — inside the capture volume BUT envelope violated.
 *   - `tower_collision`  — a solid structure (tower / OLM) penetrated.
 *   - `crash`            — ground impact without any of the above.
 *   - `none`             — no event this tick.
 *
 * Outcomes are exclusive and prioritised in that order (capture volume
 * wins over structure hit, both win over ground impact). Terminal metrics are
 * computed unconditionally so the HUD overlay always has something to
 * display.
 *
 * Collision geometry (SLS-79): the *capture volume* is always the physics
 * tower's (pinned to the RL/MPC catch target, which SLS-76's SITE_OFFSET
 * aligns the drawn cradle to). The *failure* bodies — solid structures and the
 * ground plane — are supplied by the caller as a `SiteCollision` in the frame
 * the booster is drawn in, so a hit fires where the player sees the structure.
 * Without one, the legacy physics-frame tower AABB + `y ≤ 0` ground are used.
 */

import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";
import {
  type CatchEnvelope,
  type SuccessVerdict,
  evaluateCatch,
} from "./scenarios.js";
import {
  type Aabb,
  type BodyCapsule,
  chopstickCaptureVolume,
  pointInAabb,
  towerStructureAabb,
  type TowerState,
} from "./tower.js";
import type { World } from "./world.js";

/**
 * Failure collision geometry in the frame the booster is drawn in (SLS-79).
 * `solids` are structures that end the run as `tower_collision` on contact
 * (drawn tower, OLM, …); `groundY` is the crash plane (drawn terrain height).
 * The capture volume is NOT part of this — it stays the physics tower's.
 */
export type SiteCollision = {
  readonly groundY: number;
  /** Bulk structures (tower column, OLM) — CoM-point tested (SLS-79). The
   *  booster is caught *alongside* these, so testing its long capsule against
   *  them would false-fire as its lower body passes their loose boxes. */
  readonly solids: readonly Aabb[];
  /** Thin chopstick-arm segment boxes (SLS-84) — tested against the booster
   *  CAPSULE (ADR-020) when one is supplied, so a hull graze of a beam the
   *  centre point would slip past still fails. */
  readonly armSolids?: readonly Aabb[];
};

export type CatchOutcomeKind =
  | "none"
  | "caught"
  | "near_miss"
  | "tower_collision"
  | "crash";

export type TerminalMetrics = {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly verticalSpeedMps: number;
  readonly horizontalSpeedMps: number;
  readonly tiltRad: number;
  readonly angularRateMagRadPerS: number;
  readonly fuelRemainingKg: number;
  readonly distanceToTargetM: number;
};

export type CatchOutcome = {
  readonly kind: CatchOutcomeKind;
  readonly verdict?: SuccessVerdict;
  readonly metrics: TerminalMetrics;
};

export const GROUND_Y_M = 0;

const inflateAabb = (a: Aabb, r: number): Aabb => ({
  center: a.center,
  halfExtents: Vec3.of(
    a.halfExtents.x + r,
    a.halfExtents.y + r,
    a.halfExtents.z + r,
  ),
});

/**
 * Does the booster capsule (core segment `centre ± axis·halfLength`, radius
 * `cap.radius`) overlap `aabb`? A capsule is the union of spheres along its core
 * segment, and sphere-vs-AABB is point-in-AABB-inflated-by-radius; we sample the
 * segment finely enough (~2 m spacing) that a short arm segment box can't slip
 * between samples.
 */
function capsuleOverlapsAabb(
  centre: Vec3,
  axis: Vec3,
  cap: BodyCapsule,
  aabb: Aabb,
): boolean {
  const inflated = inflateAabb(aabb, cap.radius);
  const n = Math.max(2, Math.ceil(cap.halfLength)); // ≈2 m spacing on the booster
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 2 - 1; // −1 … +1
    const s = Vec3.of(
      centre.x + axis.x * t * cap.halfLength,
      centre.y + axis.y * t * cap.halfLength,
      centre.z + axis.z * t * cap.halfLength,
    );
    if (pointInAabb(s, inflated)) return true;
  }
  return false;
}

export function evaluateCatchOutcome(
  world: World,
  envelope: CatchEnvelope,
  tower: TowerState,
  site?: SiteCollision,
  body?: BodyCapsule,
): CatchOutcome {
  const metrics = computeMetrics(world, envelope);
  const captureVol = chopstickCaptureVolume(tower);
  const p = world.rigidBody.position;
  const bodyUp = Quat.rotateVec3(world.rigidBody.attitude, Vec3.of(0, 1, 0));
  const armHit = (arm: Aabb): boolean =>
    body ? capsuleOverlapsAabb(p, bodyUp, body, arm) : pointInAabb(p, arm);

  // Capture volume wins over everything (physics-pinned catch target). This is
  // the success gate — CoM-point based so the benches are unaffected — and it is
  // checked BEFORE structure hits, so the capsule overlapping the closing arms
  // during a valid catch (the grip) reads `caught`, never a graze.
  if (pointInAabb(p, captureVol)) {
    const verdict = evaluateCatch(world, envelope);
    return {
      kind: verdict.caught ? "caught" : "near_miss",
      verdict,
      metrics,
    };
  }

  // Drawn-frame collision (SLS-79 + SLS-84). Bulk structures (tower/OLM) use the
  // CoM point — the booster is caught alongside them, so capsule-testing them
  // would false-fire. Thin chopstick arms use the booster capsule so a hull
  // graze registers. Then the ground plane (CoM point) fails as a crash.
  if (site) {
    for (const solid of site.solids) {
      if (pointInAabb(p, solid)) return { kind: "tower_collision", metrics };
    }
    for (const arm of site.armSolids ?? []) {
      if (armHit(arm)) return { kind: "tower_collision", metrics };
    }
    if (p.y <= site.groundY) return { kind: "crash", metrics };
    return { kind: "none", metrics };
  }

  // Legacy physics-frame fallback (no drawn geometry supplied): CoM-point tower
  // + ground, unchanged from SLS-79 (no capsule — the physics tower box is
  // coarse and the booster is caught next to it).
  if (pointInAabb(p, towerStructureAabb(tower))) {
    return { kind: "tower_collision", metrics };
  }

  if (p.y <= GROUND_Y_M) {
    return { kind: "crash", metrics };
  }

  return { kind: "none", metrics };
}

function computeMetrics(
  world: World,
  envelope: CatchEnvelope,
): TerminalMetrics {
  const r = world.rigidBody.position;
  const v = world.rigidBody.velocity;
  const t = envelope.targetPosition;
  const bodyUp = Quat.rotateVec3(world.rigidBody.attitude, Vec3.of(0, 1, 0));
  const tilt = Math.acos(Math.max(-1, Math.min(1, bodyUp.y)));
  const omega = world.rigidBody.angularVelocity;
  return {
    position: r,
    velocity: v,
    verticalSpeedMps: v.y,
    horizontalSpeedMps: Math.hypot(v.x, v.z),
    tiltRad: tilt,
    angularRateMagRadPerS: Math.hypot(omega.x, omega.y, omega.z),
    fuelRemainingKg: world.mass.propellantMass,
    distanceToTargetM: Math.hypot(r.x - t.x, r.y - t.y, r.z - t.z),
  };
}
