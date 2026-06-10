/**
 * R3F camera driver. Each rAF:
 *  1. Read current mode + world from the zustand stores.
 *  2. Resolve a per-mode target via `modeTargetFor`. `null` ⇒ free; we
 *     leave the camera to `<OrbitControls>`.
 *  3. Damp the three.js camera position and an internal lookAt vector
 *     toward the target with a per-mode τ.
 *  4. Clamp camera Y above ground so it can't tunnel below.
 *  5. Apply `camera.lookAt(internalLookAt)`.
 *
 * State (`prevMode`, the damped `lookAt` Vector3) is kept in refs so the
 * component never re-renders.
 */

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { MathUtils, Vector3 } from "three";

import { useCameraStore, type CameraMode } from "../../state/cameraStore";
import { useSimStore } from "../../state/simStore";

import { DEFAULT_ENV, modeTargetFor } from "./modes";

/** Per-mode damping time constants (seconds). */
const TAU_BY_MODE: Record<Exclude<CameraMode, "free">, number> = {
  chase: 0.4,
  tower: 0.6,
  ground: 0.6,
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
    if (mode === "free") {
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
