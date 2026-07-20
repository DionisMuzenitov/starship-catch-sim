/**
 * Pure camera-target math per mode. Reads only from `World` and a small
 * `env` bag of static constants; returns the desired camera position and
 * lookAt point in world frame. `CameraRig` damps toward this each frame.
 *
 * `free` returns `null` — the caller (CameraRig) must check, and let
 * `<OrbitControls>` own the camera.
 */

import { Quat, Vec3, type World } from "@starship-catch-sim/physics";

import { SITE_OFFSET } from "../../state/towerTuneStore";

import type { CameraMode } from "../../state/cameraStore";
import { cinematicTarget } from "./cinematicRigs";

// Visual ground level near the launch site. The terrain + site are drawn in a
// group shifted up by SITE_OFFSET.y (~63 m) so the drawn catch cradle meets the
// physics catch point (SLS-76), so "the ground" the player sees near the tower
// sits at ≈ SITE_OFFSET.y, NOT y=0. Ground/free cams + the camera floor key off
// this so they don't spawn underground.
export const SITE_GROUND_Y_M = SITE_OFFSET[1];

// Minimum camera Y (m) for the user-driven ground/free/orbit rigs — a touch
// above the visual site ground so they never tunnel below the terrain. Shared
// by OrbitCameraRig + FreeLookRig so the floor can't drift between them.
export const GROUND_FLOOR_M = SITE_GROUND_Y_M + 1;

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

// Tower catch cam (SLS-58): orbits a FIXED pivot at the chopstick catch point,
// seeded from the side at ~arm height so you can frame the catch and rotate /
// zoom around it. Pivot matches the free-cam tune target (the chopsticks).
const TOWER_CATCH_PIVOT = Vec3.of(8.5, 91, 0);
const TOWER_CAM_POS = Vec3.of(90, 95, 50);

// Ground cam (SLS-58): a human standing off to the side of the tower, on the
// ground (a few m above the site ground level), looking up toward the catch.
// `FreeLookRig` seeds position + look from these, then the user looks around.
const GROUND_STAND_POS = Vec3.of(100, SITE_GROUND_Y_M + 5, 60);
const GROUND_LOOK_AT = Vec3.of(8.5, 91, 0);

// Onboard — body-frame offsets so the camera tracks the rocket's orientation.
// Pulled up + behind the nose so it sits OUTSIDE the hull (SLS-58 owner
// feedback: the old (0,40,0) mount was inside the booster) and looks down the
// body toward the engines / ground.
const ONBOARD_OFFSET_BODY = Vec3.of(0, 45, -20);
const ONBOARD_LOOK_BODY = Vec3.of(0, -90, 20);

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

function towerTarget(): CameraTarget {
  // Off to the side at ~arm height, centred on the fixed catch point — the
  // caller orbits + zooms around that pivot (SLS-58) to frame the catch. Fixed
  // (not booster-tracking) so the tower/catch stays centred as the booster
  // arrives.
  return {
    position: TOWER_CAM_POS,
    lookAt: TOWER_CATCH_PIVOT,
  };
}

function groundTarget(): CameraTarget {
  // Seed for the ground first-person cam (SLS-58): a fixed human vantage on the
  // ground beside the tower, looking up toward the catch. FreeLookRig derives
  // its initial yaw/pitch from this.
  return {
    position: GROUND_STAND_POS,
    lookAt: GROUND_LOOK_AT,
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
      return towerTarget();
    case "ground":
      return groundTarget();
    case "onboard":
      return onboardTarget(world);
    case "cinematic":
      return cinematicTarget(world, t);
    case "free":
      return null;
  }
}
