/**
 * User-controllable camera for the orbit modes (SLS-58).
 *
 * Owns the single drei `<OrbitControls>` for the main scene and, per frame:
 *  - seeds the camera + orbit pivot from the mode's scripted target once on
 *    entering an orbit mode (so it starts framed, no drift), and
 *  - for `orbit-track` modes (chase / tower) translates BOTH the pivot and the
 *    camera by the target's per-frame delta, so the cam follows the moving
 *    booster while preserving the user's orbit offset (drag-orbit + wheel-zoom).
 *    (Moving only the pivot would re-aim but never translate — OrbitControls
 *    recomputes offset = camera − target each update — so the cam wouldn't
 *    follow. Hence the explicit camera translation.)
 *
 * `orbit-free` modes (ground / free) get pan enabled for free-look + movement.
 * Right-drag is reserved for the manual-flight gimbal everywhere (see
 * `input/keyboard.ts` `installPointerBindings`), so OrbitControls only claims
 * left-drag (orbit/look), the wheel (zoom), and middle-drag / two-finger (pan).
 * Camera Y is clamped above the ground so orbiting/panning can't tunnel under
 * the terrain. Disabled for `rig` modes, where `CameraRig` drives the camera.
 */

import { OrbitControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef, type ElementRef } from "react";
import { type Camera, MOUSE, Vector3 } from "three";

import { useCameraStore, type CameraMode } from "../../state/cameraStore";
import { useSimStore } from "../../state/simStore";
import { towerTuneEnabled } from "../../state/towerTuneStore";

import { isOrbitMode, MODE_POLICY } from "./cameraPolicy";
import { DEFAULT_ENV, modeTargetFor } from "./modes";

type Controls = ElementRef<typeof OrbitControls>;
type World = ReturnType<typeof useSimStore.getState>["world"];

/** Free-cam seed when entered from the tuning panel — a close SE vantage on the
 *  tower catch point so `O` lands on the chopsticks (SLS-76), else a high sky
 *  pivot for watching the descent. */
const TUNE_FREE_START = new Vector3(70, 110, 70);
const TUNE_FREE_TARGET = new Vector3(8.5, 91, 0);
const FREE_DEFAULT_TARGET = new Vector3(0, 800, 0);

/** Minimum camera Y (m) — keeps orbit/pan from tunnelling below the ground. */
const GROUND_FLOOR_M = 2;

export function OrbitCameraRig() {
  const mode = useCameraStore((s) => s.mode);
  const policy = MODE_POLICY[mode];
  const ref = useRef<Controls>(null);
  const prevModeRef = useRef<CameraMode | null>(null);
  // Last orbit-track pivot, so we can translate the camera by the target delta.
  const prevTargetRef = useRef(new Vector3());

  useFrame(({ camera }) => {
    const controls = ref.current;
    // Ref not attached yet — retry next frame WITHOUT recording the mode, so the
    // seed still fires once the controls mount (don't poison the seed guard).
    if (!controls) return;
    if (!isOrbitMode(mode)) {
      prevModeRef.current = mode;
      return;
    }
    const world = useSimStore.getState().world;

    if (prevModeRef.current !== mode) {
      seedOrbit(controls, camera, mode, world, prevTargetRef.current);
      prevModeRef.current = mode;
    }

    if (policy === "orbit-track") {
      const target = modeTargetFor(mode, world, DEFAULT_ENV, world.t);
      if (target) {
        const prev = prevTargetRef.current;
        // Translate the camera by the pivot's motion → follows while keeping the
        // user's azimuth/polar/distance (their orbit + zoom) intact.
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

  const trackable = policy === "orbit-track";
  return (
    <OrbitControls
      ref={ref}
      enabled={isOrbitMode(mode)}
      // Reserve right-drag for the gimbal: only claim left (orbit), middle (pan),
      // and the wheel (zoom). Omitting RIGHT leaves it to `installPointerBindings`.
      mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN }}
      enablePan={!trackable}
      screenSpacePanning
      maxDistance={20_000}
      minDistance={2}
    />
  );
}

/** Snap camera + pivot to the mode's scripted framing on entry, and record the
 *  pivot so the first tracked frame computes a zero delta. */
function seedOrbit(
  controls: Controls,
  camera: Camera,
  mode: CameraMode,
  world: World,
  prevTarget: Vector3,
): void {
  if (mode === "free") {
    // Keep the free cam where it is (only the pivot matters), except the
    // tuning-panel entry which jumps you onto the chopsticks.
    if (towerTuneEnabled()) {
      camera.position.copy(TUNE_FREE_START);
      controls.target.copy(TUNE_FREE_TARGET);
    } else {
      controls.target.copy(FREE_DEFAULT_TARGET);
    }
    prevTarget.copy(controls.target);
    controls.update();
    return;
  }
  const target = modeTargetFor(mode, world, DEFAULT_ENV, world.t);
  if (!target) return;
  camera.position.set(target.position.x, target.position.y, target.position.z);
  controls.target.set(target.lookAt.x, target.lookAt.y, target.lookAt.z);
  prevTarget.set(target.lookAt.x, target.lookAt.y, target.lookAt.z);
  controls.update();
}
