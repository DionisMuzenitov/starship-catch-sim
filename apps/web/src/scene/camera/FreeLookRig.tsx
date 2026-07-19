/**
 * First-person camera for ground + free (SLS-58).
 *
 *  - `look` (ground): fixed position on the ground beside the tower; left-drag
 *    looks around in place (like a human turning their head).
 *  - `fly`  (free): left-drag looks; WASD moves along the look/right vectors,
 *    R/F move up/down (Unreal-style fly). Wheel dollies forward/back.
 *
 * Owns no drei controls — it reads pointer + `flyInput` (keyboard) directly and
 * writes the camera each frame. Active only for the two free-look modes;
 * `OrbitCameraRig`/`CameraRig` own the others. Camera Y is floored above ground.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { type Camera, Vector3 } from "three";

import { useCameraStore, type CameraMode } from "../../state/cameraStore";
import { useSimStore } from "../../state/simStore";

import { isFreeLookMode, MODE_POLICY } from "./cameraPolicy";
import { flyInput, resetFlyInput } from "./flyInput";
import {
  clampPitch,
  forwardFromYawPitch,
  rightFromYaw,
  yawPitchFromDir,
} from "./freeLookMath";
import { DEFAULT_ENV, modeTargetFor, SITE_GROUND_Y_M } from "./modes";

const LOOK_SENS = 0.0026; // rad per pixel of drag
const FLY_SPEED = 90; // m/s
const WHEEL_STEP = 12; // m per wheel notch (fly dolly)
// Keep the cam a touch above the visual site ground (terrain shifted up by
// SITE_OFFSET.y) so it never drops underground.
const GROUND_FLOOR_M = SITE_GROUND_Y_M + 1;

// Scratch for reading the camera's current look direction on free-cam seed.
const _dir = new Vector3();

export function FreeLookRig() {
  const mode = useCameraStore((s) => s.mode);
  const { gl } = useThree();

  const yaw = useRef(0);
  const pitch = useRef(0);
  const posX = useRef(0);
  const posY = useRef(0);
  const posZ = useRef(0);
  const prevModeRef = useRef<CameraMode | null>(null);
  const dragging = useRef(false);
  const lastX = useRef(0);
  const lastY = useRef(0);

  // Pointer look (left-drag) + wheel dolly, on the canvas. Gated to the
  // free-look modes so it never fights OrbitControls. Right-drag is left to the
  // gimbal.
  useEffect(() => {
    const el = gl.domElement;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!isFreeLookMode(useCameraStore.getState().mode)) return;
      dragging.current = true;
      lastX.current = e.clientX;
      lastY.current = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      yaw.current -= (e.clientX - lastX.current) * LOOK_SENS;
      pitch.current = clampPitch(
        pitch.current - (e.clientY - lastY.current) * LOOK_SENS,
      );
      lastX.current = e.clientX;
      lastY.current = e.clientY;
    };
    const onUp = () => {
      dragging.current = false;
    };
    const onWheel = (e: WheelEvent) => {
      if (!isFreeLookMode(useCameraStore.getState().mode)) return;
      e.preventDefault(); // don't scroll the page
      if (MODE_POLICY[useCameraStore.getState().mode] !== "fly") return;
      const step = -Math.sign(e.deltaY) * WHEEL_STEP;
      const f = forwardFromYawPitch(yaw.current, pitch.current);
      posX.current += f.x * step;
      posY.current += f.y * step;
      posZ.current += f.z * step;
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
    };
  }, [gl]);

  useFrame(({ camera }, dt) => {
    if (!isFreeLookMode(mode)) {
      prevModeRef.current = mode;
      return;
    }
    if (prevModeRef.current !== mode) {
      seedFreeLook(mode, camera, yaw, pitch, posX, posY, posZ);
      resetFlyInput();
      dragging.current = false;
      prevModeRef.current = mode;
    }

    if (MODE_POLICY[mode] === "fly") {
      const f = forwardFromYawPitch(yaw.current, pitch.current);
      const r = rightFromYaw(yaw.current);
      const s = FLY_SPEED * dt;
      if (flyInput.forward) move(f, s, posX, posY, posZ);
      if (flyInput.back) move(f, -s, posX, posY, posZ);
      if (flyInput.right) move(r, s, posX, posY, posZ);
      if (flyInput.left) move(r, -s, posX, posY, posZ);
      if (flyInput.up) posY.current += s;
      if (flyInput.down) posY.current -= s;
    }
    if (posY.current < GROUND_FLOOR_M) posY.current = GROUND_FLOOR_M;

    const fwd = forwardFromYawPitch(yaw.current, pitch.current);
    camera.position.set(posX.current, posY.current, posZ.current);
    camera.up.set(0, 1, 0);
    camera.lookAt(
      posX.current + fwd.x,
      posY.current + fwd.y,
      posZ.current + fwd.z,
    );
  });

  return null;
}

function move(
  dir: { x: number; y: number; z: number },
  s: number,
  px: { current: number },
  py: { current: number },
  pz: { current: number },
): void {
  px.current += dir.x * s;
  py.current += dir.y * s;
  pz.current += dir.z * s;
}

/** Seed position + yaw/pitch on entering a free-look mode. */
function seedFreeLook(
  mode: CameraMode,
  camera: Camera,
  yaw: { current: number },
  pitch: { current: number },
  posX: { current: number },
  posY: { current: number },
  posZ: { current: number },
): void {
  if (MODE_POLICY[mode] === "fly") {
    // Continue from wherever the previous mode left the camera (no jump).
    posX.current = camera.position.x;
    posY.current = camera.position.y;
    posZ.current = camera.position.z;
    camera.getWorldDirection(_dir);
    const yp = yawPitchFromDir(_dir.x, _dir.y, _dir.z);
    yaw.current = yp.yaw;
    pitch.current = clampPitch(yp.pitch);
    return;
  }
  // ground: scripted fixed vantage looking toward the catch.
  const world = useSimStore.getState().world;
  const target = modeTargetFor(mode, world, DEFAULT_ENV, world.t);
  if (!target) return;
  posX.current = target.position.x;
  posY.current = target.position.y;
  posZ.current = target.position.z;
  const yp = yawPitchFromDir(
    target.lookAt.x - target.position.x,
    target.lookAt.y - target.position.y,
    target.lookAt.z - target.position.z,
  );
  yaw.current = yp.yaw;
  pitch.current = clampPitch(yp.pitch);
}
