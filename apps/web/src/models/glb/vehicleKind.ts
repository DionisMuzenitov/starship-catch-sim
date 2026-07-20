/**
 * Single source of truth for "which vehicle does this render-frame world
 * describe?" (SLS-88). The model (`BoosterFlight`) and the plume VFX
 * (`EnginePlumes`) both pick booster-vs-ship from the world payload's engine
 * count; when that discriminant was duplicated inline in each, the two could
 * silently disagree (draw the ship model but the booster plume ring). Deriving
 * it here keeps the model and its plumes on one predicate.
 *
 * We inspect the payload itself (number of engine states) rather than the
 * scenario id, so a stale-store frame mid-scenario-switch still classifies a
 * world by the shape it actually has — matching `BoosterFlight`'s original
 * rationale.
 */

import { StarshipEngines, type World } from "@starship-catch-sim/physics";

export function isShipWorld(world: World): boolean {
  return world.engineStates.length === StarshipEngines.length;
}
