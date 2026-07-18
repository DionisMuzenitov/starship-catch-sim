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
  readonly solids: readonly Aabb[];
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

export function evaluateCatchOutcome(
  world: World,
  envelope: CatchEnvelope,
  tower: TowerState,
  site?: SiteCollision,
): CatchOutcome {
  const metrics = computeMetrics(world, envelope);
  const captureVol = chopstickCaptureVolume(tower);
  const p = world.rigidBody.position;

  // Capture volume wins over everything (physics-pinned catch target).
  if (pointInAabb(p, captureVol)) {
    const verdict = evaluateCatch(world, envelope);
    return {
      kind: verdict.caught ? "caught" : "near_miss",
      verdict,
      metrics,
    };
  }

  // Drawn-frame collision (SLS-79) when supplied: solid structures fail as a
  // structure hit, then the ground plane fails as a crash.
  if (site) {
    for (const solid of site.solids) {
      if (pointInAabb(p, solid)) return { kind: "tower_collision", metrics };
    }
    if (p.y <= site.groundY) return { kind: "crash", metrics };
    return { kind: "none", metrics };
  }

  // Legacy physics-frame fallback (no drawn geometry supplied).
  const towerAabb = towerStructureAabb(tower);
  if (pointInAabb(p, towerAabb)) {
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
