/**
 * Phase classifier for the Starship belly-flop → flip → catch sequence.
 *
 * Pure function over a `World` snapshot — no internal state, no
 * transitions, no hysteresis. The classifier is a priority-ordered
 * decision tree on altitude + body tilt; SLS-21 uses it to label the
 * HUD ("· phase: …") and to gate scenario heuristics. A richer
 * controller-driven state machine can land later when the MPC stack
 * needs hysteresis to avoid chattering between adjacent phases.
 *
 * Tilt = angle between body +Y and world +Y, measured in [0, π].
 *
 *  - `entry`         — alt > 50 km (upper-atmosphere, classification by
 *                      altitude alone; tilt isn't meaningful yet because
 *                      drag is negligible).
 *  - `catch_attempt` — alt < 1 km (close to the tower regardless of pose).
 *  - For mid altitudes (1 km ≤ alt ≤ 50 km) tilt picks the phase:
 *      - tilt > 70°  ⇒ `belly_flop` (body roughly horizontal).
 *      - 20° < tilt ≤ 70° ⇒ `flip` (rotating toward vertical).
 *      - tilt ≤ 20° ⇒ `vertical` (upright, decelerating).
 */

import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";
import type { World } from "./world.js";

export type Phase =
  | "entry"
  | "belly_flop"
  | "flip"
  | "vertical"
  | "catch_attempt";

const ENTRY_ALT_M = 50_000;
const CATCH_ALT_M = 1_000;
const UPRIGHT_TILT_RAD = (20 * Math.PI) / 180;
const FLIP_MAX_TILT_RAD = (70 * Math.PI) / 180;

function tiltFromVerticalRad(world: World): number {
  const bodyUp = Quat.rotateVec3(world.rigidBody.attitude, Vec3.of(0, 1, 0));
  const cos = Math.max(-1, Math.min(1, bodyUp.y));
  return Math.acos(cos);
}

export function currentPhase(world: World): Phase {
  const alt = world.rigidBody.position.y;
  if (alt < CATCH_ALT_M) return "catch_attempt";
  if (alt > ENTRY_ALT_M) return "entry";
  const tilt = tiltFromVerticalRad(world);
  if (tilt > FLIP_MAX_TILT_RAD) return "belly_flop";
  if (tilt > UPRIGHT_TILT_RAD) return "flip";
  return "vertical";
}
