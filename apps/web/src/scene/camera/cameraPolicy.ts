/**
 * Per-camera-mode control policy (SLS-58).
 *
 * The scene has exactly one thing driving the camera at a time:
 *  - `rig`         — the imperative `CameraRig` damps the camera onto a scripted
 *                    per-mode target every frame (first-person / auto-movie).
 *  - `orbit-track` — drei `OrbitControls` owns the camera; `OrbitCameraRig`
 *                    keeps the orbit pivot glued to the moving target each frame,
 *                    so the cam auto-follows while the user can drag-orbit + zoom.
 *  - `orbit-free`  — `OrbitControls` owns the camera with pan enabled (free-look,
 *                    zoom, drag-to-move); not target-locked.
 *
 * `CameraRig` handles `rig` modes and bails for the rest; `OrbitCameraRig`
 * handles the orbit modes and is disabled for `rig`. They never both touch the
 * camera in the same frame.
 */

import type { CameraMode } from "../../state/cameraStore";

export type CameraControlPolicy = "rig" | "orbit-track" | "orbit-free";

export const MODE_POLICY: Record<CameraMode, CameraControlPolicy> = {
  // Focused cams: orbit + zoom around the tracked booster, auto-following it.
  chase: "orbit-track",
  tower: "orbit-track",
  // Free-look cams: rotate / zoom / pan, not target-locked.
  ground: "orbit-free",
  free: "orbit-free",
  // Scripted cams: the rig drives them.
  onboard: "rig",
  cinematic: "rig",
};

/** True when `OrbitControls` (not the rig) owns the camera in this mode. */
export function isOrbitMode(mode: CameraMode): boolean {
  return MODE_POLICY[mode] !== "rig";
}
