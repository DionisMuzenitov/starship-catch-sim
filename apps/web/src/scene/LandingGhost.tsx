/**
 * Ghost booster for landing-target alignment (SLS-76, `?tune=1` only): a
 * static upright booster the owner drags (panel sliders) into the visual
 * chopstick cradle. The baked ghost position defines the visual catch point;
 * `SITE_OFFSET` then shifts the scenery so it coincides with the physics
 * catch point — the physics frame itself is never touched.
 */
import { useMemo } from "react";

import {
  BoosterFins,
  type EngineState,
  type SurfaceState,
  SuperHeavyEngines,
} from "@starship-catch-sim/physics";

import { VehicleModel } from "../models/glb/VehicleModel";
import { useTowerTuneStore } from "../state/towerTuneStore";

const UPRIGHT = { x: 0, y: 0, z: 0, w: 1 };

// All engines off / fins neutral, but correctly SHAPED — the procedural
// fallback model asserts one state per engine (33) and per fin (4).
const ENGINES_OFF: EngineState[] = SuperHeavyEngines.map(() => ({
  gimbalPitch: 0,
  gimbalYaw: 0,
  throttle: 0,
  on: false,
}));
const FINS_NEUTRAL: SurfaceState[] = BoosterFins.map(() => ({ deflection: 0 }));

export function LandingGhost() {
  const x = useTowerTuneStore((s) => s.ghostX);
  const y = useTowerTuneStore((s) => s.ghostY);
  const z = useTowerTuneStore((s) => s.ghostZ);
  const position = useMemo(() => ({ x, y, z }), [x, y, z]);
  return (
    <VehicleModel
      isShip={false}
      position={position}
      attitude={UPRIGHT}
      engineStates={ENGINES_OFF}
      surfaceStates={FINS_NEUTRAL}
    />
  );
}
