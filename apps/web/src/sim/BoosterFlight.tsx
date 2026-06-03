/**
 * Renders the booster at the runner's current world transform.
 * Subscribes to `useSimStore`; mutates nothing.
 */

import { BoosterModel } from "../models";
import { useSimStore } from "../state/simStore.js";

export function BoosterFlight() {
  const world = useSimStore((s) => s.world);
  const altitudeFactor = Math.min(1, Math.max(0, world.rigidBody.position.y / 100_000));
  return (
    <BoosterModel
      position={world.rigidBody.position}
      attitude={world.rigidBody.attitude}
      engineStates={world.engineStates}
      surfaceStates={world.surfaceStates}
      altitudeFactor={altitudeFactor}
    />
  );
}
