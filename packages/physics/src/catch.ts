/**
 * Catch detection — pure outcome classifier called from the sim tick when
 * the rocket gets close enough to matter. Combines the existing
 * `evaluateCatch()` envelope check with the tower geometry primitives in
 * `tower.ts` to produce one of five outcomes:
 *
 *   - `caught`           — inside the capture volume AND envelope satisfied.
 *   - `near_miss`        — inside the capture volume BUT envelope violated.
 *   - `tower_collision`  — bounding box of the tower trusses penetrated.
 *   - `crash`            — ground impact (y ≤ 0) without any of the above.
 *   - `none`             — no event this tick.
 *
 * Outcomes are exclusive and prioritised in that order (capture volume
 * wins over tower hit, both win over ground impact). Terminal metrics are
 * computed unconditionally so the HUD overlay always has something to
 * display.
 */

import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";
import {
  type CatchEnvelope,
  type SuccessVerdict,
  evaluateCatch,
} from "./scenarios.js";
import {
  chopstickCaptureVolume,
  pointInAabb,
  towerStructureAabb,
  type TowerState,
} from "./tower.js";
import type { World } from "./world.js";

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
): CatchOutcome {
  const metrics = computeMetrics(world, envelope);
  const captureVol = chopstickCaptureVolume(tower);
  const p = world.rigidBody.position;

  if (pointInAabb(p, captureVol)) {
    const verdict = evaluateCatch(world, envelope);
    return {
      kind: verdict.caught ? "caught" : "near_miss",
      verdict,
      metrics,
    };
  }

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
