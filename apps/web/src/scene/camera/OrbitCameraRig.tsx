/**
 * Orbit camera for chase + tower (SLS-58).
 *
 * Owns the scene's drei `<OrbitControls>`; enabled only for the orbit modes:
 *  - `orbit-follow` (chase): seeds the framing on entry, then translates BOTH the
 *    pivot and the camera by the booster's per-frame delta, so the cam follows
 *    the booster while the user's drag-orbit + wheel-zoom offset rides along.
 *    (Moving only the pivot would re-aim but never translate — OrbitControls
 *    recomputes offset = camera − target each update.)
 *  - `orbit-fixed`  (tower): seeds a side vantage looking at the FIXED catch
 *    point, then leaves the pivot put — the user orbits + zooms around the tower
 *    to frame the catch.
 *
 * Right-drag is reserved for the manual-flight gimbal (see `installPointerBindings`),
 * so OrbitControls only claims left-drag (orbit) and the wheel (zoom); pan is off
 * (these cams pivot on a point, not free-move). Ground + free are owned by
 * `FreeLookRig`; onboard + cinematic by `CameraRig`. Camera Y is floored above
 * the terrain.
 */

import { OrbitControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef, type ElementRef } from "react";
import { type Camera, MOUSE, Vector3 } from "three";

import { useCameraStore, type CameraMode } from "../../state/cameraStore";
import { useSimStore } from "../../state/simStore";

import { isOrbitMode, MODE_POLICY } from "./cameraPolicy";
import { DEFAULT_ENV, GROUND_FLOOR_M, modeTargetFor } from "./modes";

type Controls = ElementRef<typeof OrbitControls>;
type World = ReturnType<typeof useSimStore.getState>["world"];

export function OrbitCameraRig() {
  const mode = useCameraStore((s) => s.mode);
  const ref = useRef<Controls>(null);
  const prevModeRef = useRef<CameraMode | null>(null);
  // Last follow pivot, so we can translate the camera by the target delta.
  const prevTargetRef = useRef(new Vector3());

  useFrame(({ camera }) => {
    const controls = ref.current;
    if (!controls) return; // ref not attached yet — retry without seeding
    if (!isOrbitMode(mode)) {
      prevModeRef.current = mode;
      return;
    }
    const world = useSimStore.getState().world;

    const seeding = prevModeRef.current !== mode;
    if (seeding) {
      seedOrbit(controls, camera, mode, world, prevTargetRef.current);
      prevModeRef.current = mode;
    }

    // Chase follows: translate camera + pivot by the booster's motion, keeping
    // the user's orbit offset. Tower's pivot is fixed, so nothing to update.
    // Skip on the seed frame — seedOrbit already framed the current world, so
    // the delta would be zero (avoids recomputing modeTargetFor twice).
    if (!seeding && MODE_POLICY[mode] === "orbit-follow") {
      const target = modeTargetFor(mode, world, DEFAULT_ENV, world.t);
      if (target) {
        const prev = prevTargetRef.current;
        camera.position.x += target.lookAt.x - prev.x;
        camera.position.y += target.lookAt.y - prev.y;
        camera.position.z += target.lookAt.z - prev.z;
        controls.target.set(target.lookAt.x, target.lookAt.y, target.lookAt.z);
        prev.set(target.lookAt.x, target.lookAt.y, target.lookAt.z);
      }
    }

    controls.update();
    if (camera.position.y < GROUND_FLOOR_M) camera.position.y = GROUND_FLOOR_M;
  });

  return (
    <OrbitControls
      ref={ref}
      enabled={isOrbitMode(mode)}
      // Reserve right-drag for the gimbal: only claim left (orbit) + wheel (zoom).
      mouseButtons={{ LEFT: MOUSE.ROTATE }}
      enablePan={false}
      maxDistance={20_000}
      minDistance={2}
    />
  );
}

/** Snap camera + pivot to the mode's scripted framing on entry. */
function seedOrbit(
  controls: Controls,
  camera: Camera,
  mode: CameraMode,
  world: World,
  prevTarget: Vector3,
): void {
  const target = modeTargetFor(mode, world, DEFAULT_ENV, world.t);
  if (!target) return;
  camera.position.set(target.position.x, target.position.y, target.position.z);
  controls.target.set(target.lookAt.x, target.lookAt.y, target.lookAt.z);
  prevTarget.set(target.lookAt.x, target.lookAt.y, target.lookAt.z);
  controls.update();
}
