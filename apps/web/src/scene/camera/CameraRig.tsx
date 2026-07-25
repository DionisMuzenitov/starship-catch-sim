/**
 * R3F camera driver for the SCRIPTED modes (onboard, cinematic). The other
 * modes are user-controlled and owned by `OrbitCameraRig` (chase, tower) or
 * `FreeLookRig` (ground, free); this rig bails for them (see `isRigMode`).
 *
 *  - **onboard** — a first-person body-mounted view: resolve a target via
 *    `modeTargetFor` and damp the camera position + an internal lookAt toward it.
 *  - **cinematic** — the moving auto-director (`cinematicView`), applied
 *    DIRECTLY each frame (`camera = boosterPos + offset`, no damping). Like the
 *    chase cam's delta-follow, this glues the booster to frame with zero lag at
 *    any sim speed; the cinematic motion rides a REAL-time clock so it stays
 *    smooth even at 8× (the fix for "the camera lags when I speed the sim up").
 *
 * State (`prevMode`, the damped `lookAt`, the cinematic clock) is kept in refs
 * so the component never re-renders.
 */

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { MathUtils, Vector3 } from "three";

import { useCameraStore, type CameraMode } from "../../state/cameraStore";
import { useSimStore } from "../../state/simStore";

import { isRigMode } from "./cameraPolicy";
import { CATCH_CAM_ALT_M, cinematicView } from "./cinematicRigs";
import { DEFAULT_ENV, GROUND_FLOOR_M, modeTargetFor } from "./modes";

/** Damping time constant for the onboard rig (s). */
const ONBOARD_TAU = 0.2;

/** Onboard is MOUNTED on the booster, so it keeps a low physics-frame floor and
 *  stays glued to the vehicle (unlike the positioned cinematic cam, which floors
 *  at the shifted visual ground, `GROUND_FLOOR_M`, so it never renders through
 *  the drawn terrain — SLS-87). */
const ONBOARD_FLOOR_M = 2;

export function CameraRig() {
  const lookAtRef = useRef(new Vector3(0, 800, 0));
  const prevModeRef = useRef<CameraMode>("chase");
  // Real-time clock for the cinematic director, reset on entering the mode.
  const cineTimeRef = useRef(0);
  // Latch: once the booster reaches catch altitude the money shot holds, so a
  // bouncing/overshooting descent can't strobe it back to the orbit.
  const cineCatchRef = useRef(false);

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

    // Cinematic: apply the moving director DIRECTLY (camera = boosterPos +
    // offset) — no damping — so the booster is glued to frame with zero lag at
    // any sim speed (like the chase cam's delta-follow). The cinematic motion
    // rides a REAL-time clock (`dt`), so it stays smooth even at 8×.
    if (mode === "cinematic") {
      if (prevModeRef.current !== mode) {
        cineTimeRef.current = 0;
        cineCatchRef.current = false;
        prevModeRef.current = mode;
      }
      cineTimeRef.current += dt;
      if (world.rigidBody.position.y < CATCH_CAM_ALT_M) {
        cineCatchRef.current = true;
      }
      const view = cinematicView(world, cineTimeRef.current, cineCatchRef.current);
      camera.position.set(view.position.x, view.position.y, view.position.z);
      if (camera.position.y < GROUND_FLOOR_M) camera.position.y = GROUND_FLOOR_M;
      camera.lookAt(view.lookAt.x, view.lookAt.y, view.lookAt.z);
      return;
    }

    // Onboard: damp the camera + an internal lookAt toward the per-frame target.
    const target = modeTargetFor(mode, world, DEFAULT_ENV);
    if (!target) return;

    // On mode change snap the lookAt to the new mode's lookAt so the
    // camera doesn't sweep its lookAt halfway across the scene as it
    // damps; only the position interpolates visibly. This avoids the
    // "drunken zoom" you get otherwise.
    if (prevModeRef.current !== mode) {
      lookAtRef.current.set(target.lookAt.x, target.lookAt.y, target.lookAt.z);
      prevModeRef.current = mode;
    }

    const lambda = 1 / ONBOARD_TAU;
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
    if (camera.position.y < ONBOARD_FLOOR_M) camera.position.y = ONBOARD_FLOOR_M;

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
