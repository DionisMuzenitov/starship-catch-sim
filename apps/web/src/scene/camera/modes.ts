/**
 * Pure camera-target math per mode. Reads only from `World` and a small
 * `env` bag of static constants; returns the desired camera position and
 * lookAt point in world frame. `CameraRig` damps toward this each frame.
 *
 * `free` returns `null` — the caller (CameraRig) must check, and let
 * `<OrbitControls>` own the camera.
 */

import { Quat, Vec3, type World } from "@starship-catch-sim/physics";

import { MECHAZILLA_TOWER_HEIGHT_M } from "../MechazillaTower";

import type { CameraMode } from "../../state/cameraStore";
import { cinematicTarget } from "./cinematicRigs";

export type CameraTarget = {
  position: Vec3;
  lookAt: Vec3;
};

export type CameraEnv = {
  groundY: number;
};

export const DEFAULT_ENV: CameraEnv = { groundY: 0 };

// Chase — world-up-locked third-person follow. The offset direction (-Z)
// is a v1 simplification; the rocket has no inherent "forward" until it
// gains horizontal velocity. Distance/height scale gently with altitude
// so the rocket stays framed during ascent.
const CHASE_BASE_DISTANCE = 120;
const CHASE_DISTANCE_PER_M = 0.1;
const CHASE_MAX_DISTANCE = 600;
const CHASE_BASE_HEIGHT = 30;
const CHASE_HEIGHT_PER_M = 0.1;
const CHASE_MAX_HEIGHT = 200;

// Ground tripod — a defensible position south-east of the pad.
const GROUND_CAM_POS = Vec3.of(300, 5, 300);

// Onboard — body-frame offsets so the camera tracks the rocket's
// orientation. (0, 40, 0) sits near the booster nose (CoM ~28-35 m of
// 71 m total height); looking ~100 m down the body axis keeps the lookAt
// well behind the camera so the orientation is unambiguous.
const ONBOARD_OFFSET_BODY = Vec3.of(0, 40, 0);
const ONBOARD_LOOK_BODY = Vec3.of(0, -100, 0);

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

function chaseTarget(world: World, env: CameraEnv): CameraTarget {
  const r = world.rigidBody.position;
  const altAGL = Math.max(0, r.y - env.groundY);
  const distance = clamp(
    CHASE_BASE_DISTANCE + CHASE_DISTANCE_PER_M * altAGL,
    CHASE_BASE_DISTANCE,
    CHASE_MAX_DISTANCE,
  );
  const height = clamp(
    CHASE_BASE_HEIGHT + CHASE_HEIGHT_PER_M * altAGL,
    CHASE_BASE_HEIGHT,
    CHASE_MAX_HEIGHT,
  );
  return {
    position: Vec3.of(r.x, r.y + height, r.z - distance),
    lookAt: r,
  };
}

function towerTarget(world: World): CameraTarget {
  // Perched just above and outboard of the truss on the chopstick (+X) side:
  // the tower structure is mounted in the main scene now (SLS-57), so a
  // camera at the exact top-centre would sit inside the lattice and clip
  // through beams when looking down at the catch.
  return {
    position: Vec3.of(10, MECHAZILLA_TOWER_HEIGHT_M + 3, 0),
    lookAt: world.rigidBody.position,
  };
}

function groundTarget(world: World): CameraTarget {
  return {
    position: GROUND_CAM_POS,
    lookAt: world.rigidBody.position,
  };
}

function onboardTarget(world: World): CameraTarget {
  const r = world.rigidBody.position;
  const q = world.rigidBody.attitude;
  const offsetWorld = Quat.rotateVec3(q, ONBOARD_OFFSET_BODY);
  const position = Vec3.add(r, offsetWorld);
  const lookOffsetWorld = Quat.rotateVec3(q, ONBOARD_LOOK_BODY);
  const lookAt = Vec3.add(position, lookOffsetWorld);
  return { position, lookAt };
}

/**
 * Compute the camera's desired position and lookAt for the given mode.
 * Returns `null` for `free` — the caller delegates to OrbitControls.
 *
 * @param mode  Current camera mode.
 * @param world Current sim state.
 * @param env   Static environment constants (ground level, etc.).
 * @param t     Sim time (s) — used by cinematic rig cycling.
 */
export function modeTargetFor(
  mode: CameraMode,
  world: World,
  env: CameraEnv,
  t: number,
): CameraTarget | null {
  switch (mode) {
    case "chase":
      return chaseTarget(world, env);
    case "tower":
      return towerTarget(world);
    case "ground":
      return groundTarget(world);
    case "onboard":
      return onboardTarget(world);
    case "cinematic":
      return cinematicTarget(world, t);
    case "free":
      return null;
  }
}
