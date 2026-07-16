/**
 * Ghost booster for landing-target alignment (SLS-76, `?tune=1` only): a
 * static upright booster the owner drags (panel sliders) into the visual
 * chopstick cradle. The baked ghost position defines the visual catch point;
 * `SITE_OFFSET` then shifts the scenery so it coincides with the physics
 * catch point — the physics frame itself is never touched.
 */
import { VehicleModel } from "../models/glb/VehicleModel";
import { useTowerTuneStore } from "../state/towerTuneStore";

const UPRIGHT = { x: 0, y: 0, z: 0, w: 1 };

export function LandingGhost() {
  const x = useTowerTuneStore((s) => s.ghostX);
  const y = useTowerTuneStore((s) => s.ghostY);
  const z = useTowerTuneStore((s) => s.ghostZ);
  return (
    <VehicleModel
      isShip={false}
      position={{ x, y, z }}
      attitude={UPRIGHT}
      engineStates={[]}
      surfaceStates={[]}
    />
  );
}
