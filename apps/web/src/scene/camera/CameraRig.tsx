/**
 * R3F camera driver for the SCRIPTED modes only (onboard, cinematic). The other
 * modes are user-controlled and owned by `OrbitCameraRig` (chase, tower) or
 * `FreeLookRig` (ground, free); this rig bails for them (see `isRigMode`). Each
 * rAF, for a rig mode:
 *  1. Resolve a per-mode target via `modeTargetFor`.
 *  2. Damp the three.js camera position + an internal lookAt vector toward it
 *     with a per-mode τ.
 *  3. Clamp camera Y above ground; apply `camera.lookAt(internalLookAt)`.
 *
 * State (`prevMode`, the damped `lookAt` Vector3) is kept in refs so the
 * component never re-renders.
 */

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { MathUtils, Vector3 } from "three";

import { useCameraStore, type CameraMode } from "../../state/cameraStore";
import { useSimStore } from "../../state/simStore";

import { isRigMode, type RigMode } from "./cameraPolicy";
import { DEFAULT_ENV, modeTargetFor } from "./modes";

/** Per-mode damping time constants (seconds). Only the rig modes reach the
 *  damping; the orbit modes are owned by OrbitControls and bail first. */
const TAU_BY_MODE: Record<RigMode, number> = {
  onboard: 0.2,
  cinematic: 1.0,
};

/** Minimum camera Y in world frame (m) — keeps it above the ground. */
const GROUND_FLOOR_M = 2;

export function CameraRig() {
  const lookAtRef = useRef(new Vector3(0, 800, 0));
  const prevModeRef = useRef<CameraMode>("chase");

  useFrame(({ camera }, dt) => {
    const mode = useCameraStore.getState().mode;
    // The user-driven modes are owned elsewhere — chase/tower by
    // <OrbitCameraRig> (OrbitControls), ground/free by <FreeLookRig>; this rig
    // only drives the scripted first-person / movie modes (onboard, cinematic).
    // Remember the mode so re-entering a rig mode still snaps its lookAt.
    if (!isRigMode(mode)) {
      prevModeRef.current = mode;
      return;
    }
    const world = useSimStore.getState().world;
    const target = modeTargetFor(mode, world, DEFAULT_ENV, world.t);
    if (!target) return;

    // On mode change snap the lookAt to the new mode's lookAt so the
    // camera doesn't sweep its lookAt halfway across the scene as it
    // damps; only the position interpolates visibly. This avoids the
    // "drunken zoom" you get otherwise.
    if (prevModeRef.current !== mode) {
      lookAtRef.current.set(target.lookAt.x, target.lookAt.y, target.lookAt.z);
      prevModeRef.current = mode;
    }

    const tau = TAU_BY_MODE[mode];
    const lambda = 1 / tau;
    camera.position.x = MathUtils.damp(
      camera.position.x,
      target.position.x,
      lambda,
      dt,
    );
    camera.position.y = MathUtils.damp(
      camera.position.y,
      target.position.y,
      lambda,
      dt,
    );
    camera.position.z = MathUtils.damp(
      camera.position.z,
      target.position.z,
      lambda,
      dt,
    );
    if (camera.position.y < GROUND_FLOOR_M) camera.position.y = GROUND_FLOOR_M;

    lookAtRef.current.x = MathUtils.damp(
      lookAtRef.current.x,
      target.lookAt.x,
      lambda,
      dt,
    );
    lookAtRef.current.y = MathUtils.damp(
      lookAtRef.current.y,
      target.lookAt.y,
      lambda,
      dt,
    );
    lookAtRef.current.z = MathUtils.damp(
      lookAtRef.current.z,
      target.lookAt.z,
      lambda,
      dt,
    );

    camera.lookAt(lookAtRef.current);
  });

  return null;
}
