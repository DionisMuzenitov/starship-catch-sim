/**
 * Renders the active vehicle (Booster or Starship) at the runner's
 * current world transform. Picks the model by inspecting the world
 * payload itself (number of engine states) rather than the scenario
 * id, so a stale-store frame during a scenario switch still chooses
 * a model whose shape matches the world it's about to render.
 * Subscribes to `useSimStore`; mutates nothing.
 */

import { VehicleModel, isShipWorld } from "../models/glb";
import { useSimStore } from "../state/simStore.js";

export function BoosterFlight() {
  const world = useSimStore((s) => s.world);
  const altitudeFactor = Math.min(
    1,
    Math.max(0, world.rigidBody.position.y / 100_000),
  );
  const isShip = isShipWorld(world);
  return (
    <VehicleModel
      isShip={isShip}
      position={world.rigidBody.position}
      attitude={world.rigidBody.attitude}
      engineStates={world.engineStates}
      surfaceStates={world.surfaceStates}
      altitudeFactor={altitudeFactor}
    />
  );
}
