/**
 * User-controllable camera for the orbit modes (SLS-58).
 *
 * Owns the single drei `<OrbitControls>` for the main scene and, per frame:
 *  - seeds the camera + orbit pivot from the mode's scripted target once on
 *    entering an orbit mode (so it starts framed, no drift), and
 *  - for `orbit-track` modes (chase / tower) keeps the pivot glued to the moving
 *    booster each frame, so the cam auto-follows while the user's drag-orbit +
 *    wheel-zoom ride along.
 *
 * `orbit-free` modes (ground / free) get pan enabled for free-look + movement.
 * Right-drag is reserved for the manual-flight gimbal everywhere (see
 * `input/keyboard.ts` `installPointerBindings`), so OrbitControls only claims
 * left-drag (orbit/look), the wheel (zoom), and middle-drag / two-finger (pan).
 * Disabled entirely for `rig` modes, where `CameraRig` drives the camera.
 */

import { OrbitControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef, type ElementRef } from "react";
import { MOUSE, type PerspectiveCamera, Vector3 } from "three";

import { useCameraStore, type CameraMode } from "../../state/cameraStore";
import { useSimStore } from "../../state/simStore";
import { towerTuneEnabled } from "../../state/towerTuneStore";

import { MODE_POLICY } from "./cameraPolicy";
import { DEFAULT_ENV, modeTargetFor } from "./modes";

type Controls = ElementRef<typeof OrbitControls>;

/** Free-cam seed when entered from the tuning panel — a close SE vantage on the
 *  tower catch point so `O` lands on the chopsticks (SLS-76), else a high sky
 *  pivot for watching the descent. */
const TUNE_FREE_START = new Vector3(70, 110, 70);
const TUNE_FREE_TARGET = new Vector3(8.5, 91, 0);
const FREE_DEFAULT_TARGET = new Vector3(0, 800, 0);

export function OrbitCameraRig() {
  const mode = useCameraStore((s) => s.mode);
  const policy = MODE_POLICY[mode];
  const ref = useRef<Controls>(null);
  const prevModeRef = useRef<CameraMode | null>(null);

  useFrame(({ camera }) => {
    const controls = ref.current;
    if (!controls || policy === "rig") {
      // CameraRig owns the camera; just remember the mode so the next orbit
      // entry re-seeds cleanly.
      prevModeRef.current = mode;
      return;
    }
    const world = useSimStore.getState().world;

    if (prevModeRef.current !== mode) {
      seedOrbit(controls, camera as PerspectiveCamera, mode, world);
      prevModeRef.current = mode;
    }

    if (policy === "orbit-track") {
      const target = modeTargetFor(mode, world, DEFAULT_ENV, world.t);
      if (target) {
        controls.target.set(target.lookAt.x, target.lookAt.y, target.lookAt.z);
      }
    }
    controls.update();
  });

  const trackable = policy === "orbit-track";
  return (
    <OrbitControls
      ref={ref}
      enabled={policy !== "rig"}
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

/** Snap camera + pivot to the mode's scripted framing on entry. */
function seedOrbit(
  controls: Controls,
  camera: PerspectiveCamera,
  mode: CameraMode,
  world: ReturnType<typeof useSimStore.getState>["world"],
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
    controls.update();
    return;
  }
  const target = modeTargetFor(mode, world, DEFAULT_ENV, world.t);
  if (!target) return;
  camera.position.set(target.position.x, target.position.y, target.position.z);
  controls.target.set(target.lookAt.x, target.lookAt.y, target.lookAt.z);
  controls.update();
}
