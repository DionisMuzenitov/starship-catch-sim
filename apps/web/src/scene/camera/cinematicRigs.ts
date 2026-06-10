/**
 * Hand-picked cinematic rigs for the `M` (movie) camera mode. Cycles
 * through the list on a fixed time interval. Each rig is a function so
 * it can adapt to the current world (e.g. follow the booster's CoM).
 *
 * Four rigs in v1, ~6 s per rig. Bezier paths can come later if needed
 * for a real trailer.
 */

import { Vec3, type World } from "@starship-catch-sim/physics";

import { MECHAZILLA_TOWER_HEIGHT_M } from "../MechazillaTower";

import type { CameraTarget } from "./modes";

const RIG_INTERVAL_S = 6;

type Rig = (world: World) => CameraTarget;

// 1. Low-and-wide — a long lens from far south-east of the pad. Booster
//    is silhouetted against the sky.
const lowAndWide: Rig = (world) => ({
  position: Vec3.of(450, 8, 450),
  lookAt: world.rigidBody.position,
});

// 2. Close-behind — like chase, but tighter and lower. Good for "diving"
//    descent shots.
const closeBehind: Rig = (world) => {
  const r = world.rigidBody.position;
  return {
    position: Vec3.of(r.x + 25, r.y + 10, r.z - 70),
    lookAt: r,
  };
};

// 3. Tower-top long lens — captures the booster's last seconds before
//    the catch. Camera at the tower top, slightly outside the legs.
const towerTopLongLens: Rig = (world) => ({
  position: Vec3.of(20, MECHAZILLA_TOWER_HEIGHT_M - 10, 20),
  lookAt: world.rigidBody.position,
});

// 4. Nose-side — close, off the rocket's +X side, looking straight at
//    the body. Shows engine ignition and grid-fin movement in detail.
const noseSide: Rig = (world) => {
  const r = world.rigidBody.position;
  return {
    position: Vec3.of(r.x + 30, r.y + 40, r.z),
    lookAt: Vec3.of(r.x, r.y + 30, r.z),
  };
};

const RIGS: readonly Rig[] = [
  lowAndWide,
  closeBehind,
  towerTopLongLens,
  noseSide,
];

/**
 * Cinematic rig target for the given sim time. Deterministic — the rig
 * index is `floor(t / RIG_INTERVAL_S) mod RIGS.length`.
 */
export function cinematicTarget(world: World, t: number): CameraTarget {
  const idx = Math.floor(Math.max(0, t) / RIG_INTERVAL_S) % RIGS.length;
  return RIGS[idx]!(world);
}

export const __forTests = {
  RIGS,
  RIG_INTERVAL_S,
};
