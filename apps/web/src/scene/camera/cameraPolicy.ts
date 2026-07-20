/**
 * Per-camera-mode control policy (SLS-58).
 *
 * Exactly one driver owns the camera per frame, gated on the mode's policy:
 *  - `orbit-follow` (chase)  — `OrbitControls` orbits + zooms around the booster,
 *                              and `OrbitCameraRig` keeps the pivot glued to it so
 *                              the cam auto-follows while the user drag-orbits.
 *  - `orbit-fixed`  (tower)  — `OrbitControls` orbits + zooms around a FIXED pivot
 *                              (the tower catch point); seeded from the side.
 *  - `look`         (ground) — `FreeLookRig` first-person look in place (drag to
 *                              look around; position fixed on the ground).
 *  - `fly`          (free)   — `FreeLookRig` first-person look + WASD/RF movement
 *                              (Unreal-style fly).
 *  - `rig`   (onboard/cinematic) — the imperative `CameraRig` drives a scripted
 *                              per-mode target.
 */

import type { CameraMode } from "../../state/cameraStore";

export type CameraControlPolicy =
  | "orbit-follow"
  | "orbit-fixed"
  | "look"
  | "fly"
  | "rig";

/** Modes the imperative `CameraRig` drives. */
export type RigMode = Extract<CameraMode, "onboard" | "cinematic">;

export const MODE_POLICY: Record<CameraMode, CameraControlPolicy> = {
  chase: "orbit-follow",
  tower: "orbit-fixed",
  ground: "look",
  free: "fly",
  onboard: "rig",
  cinematic: "rig",
};

/** True when `OrbitControls` owns the camera (chase / tower). */
export function isOrbitMode(mode: CameraMode): boolean {
  const p = MODE_POLICY[mode];
  return p === "orbit-follow" || p === "orbit-fixed";
}

/** True when `FreeLookRig` owns the camera (ground / free). */
export function isFreeLookMode(mode: CameraMode): boolean {
  const p = MODE_POLICY[mode];
  return p === "look" || p === "fly";
}

/** Narrowing guard: true when the imperative `CameraRig` drives this mode. */
export function isRigMode(mode: CameraMode): mode is RigMode {
  return MODE_POLICY[mode] === "rig";
}
