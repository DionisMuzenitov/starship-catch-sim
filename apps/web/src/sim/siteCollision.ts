/**
 * Drawn-frame collision geometry for the sim runner (SLS-79).
 *
 * The booster renders at its physics position, but SLS-76's SITE_OFFSET draws
 * the tower / OLM / terrain shifted so the visual chopstick cradle lands on the
 * physics catch point. So a *failure* collision (ground, tower, OLM) must be
 * tested where those structures are DRAWN, not at their physics-frame origin —
 * otherwise a crash/tower-hit fires nowhere near what the player sees (the
 * booster visibly sinks through the terrain / OLM). The capture volume is NOT
 * here: it stays the physics tower's, pinned to the RL/MPC target, and the
 * SITE_OFFSET already aligns the drawn cradle to it.
 *
 * These use the *baked* tuning defaults (normal play); the live `?tune=1` store
 * only moves things while the owner is aligning.
 */
import {
  type Aabb,
  type SiteCollision,
  TOWER_HEIGHT_M,
  towerStructureAabb,
  DEFAULT_TOWER_STATE,
  Vec3,
} from "@starship-catch-sim/physics";

import {
  OLM_DECK_HEIGHT_M,
  OLM_POS_X,
  OLM_POS_Z,
  OLM_RING_RADIUS_M,
} from "../scene/LaunchSite";
import {
  DEFAULT_OLM_DX,
  DEFAULT_OLM_DZ,
  DEFAULT_TOWER_DX,
  DEFAULT_TOWER_DZ,
  SITE_OFFSET,
} from "../state/towerTuneStore";

/** The tower footprint is drawn yawed (~47°); inflate the AABB so the rotated
 *  lattice still falls inside it (a square rotated 45° needs √2 ≈ 1.5×). */
const YAW_INFLATE = 1.5;

function translate(a: Aabb, dx: number, dy: number, dz: number): Aabb {
  return {
    center: Vec3.of(a.center.x + dx, a.center.y + dy, a.center.z + dz),
    halfExtents: a.halfExtents,
  };
}

/** Drawn tower lattice: the physics structure AABB moved to where the column
 *  is rendered (tower offset + SITE_OFFSET), footprint inflated for the yaw. */
function drawnTowerAabb(): Aabb {
  const base = towerStructureAabb(DEFAULT_TOWER_STATE);
  const moved = translate(
    base,
    DEFAULT_TOWER_DX + SITE_OFFSET[0],
    SITE_OFFSET[1],
    DEFAULT_TOWER_DZ + SITE_OFFSET[2],
  );
  return {
    center: moved.center,
    halfExtents: Vec3.of(
      base.halfExtents.x * YAW_INFLATE,
      TOWER_HEIGHT_M / 2,
      base.halfExtents.z * YAW_INFLATE,
    ),
  };
}

/** Drawn OLM: a box around the ring + legs at the rendered mount position.
 *  Spans from the drawn ground up over the deck (+ ring/plate on top). */
function drawnOlmAabb(): Aabb {
  const topM = OLM_DECK_HEIGHT_M + 3; // deck + ring/plate stack
  const halfXZ = OLM_RING_RADIUS_M + 3; // ring radius + apron margin
  return {
    center: Vec3.of(
      OLM_POS_X + DEFAULT_OLM_DX + SITE_OFFSET[0],
      SITE_OFFSET[1] + topM / 2,
      OLM_POS_Z + DEFAULT_OLM_DZ + SITE_OFFSET[2],
    ),
    halfExtents: Vec3.of(halfXZ, topM / 2, halfXZ),
  };
}

/** Collision geometry in the frame the booster is drawn in (SLS-79). */
export function drawnSiteCollision(): SiteCollision {
  return {
    groundY: SITE_OFFSET[1], // drawn terrain height under the tower
    solids: [drawnTowerAabb(), drawnOlmAabb()],
  };
}
