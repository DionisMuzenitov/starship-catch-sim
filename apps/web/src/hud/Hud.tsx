/**
 * Telemetry HUD composer. Branches on `hudStore.mode`:
 *   - off:     nothing
 *   - minimal: just the status banner + altitude strip
 *   - full:    the lot
 *
 * `ImpactReticle` lives inside the Canvas (see Scene.tsx) because it
 * uses drei's `<Html>` to project from world space; everything else is
 * a regular DOM overlay.
 *
 * Mobile fallback: at `<sm` viewports the bottom corners hide; the top
 * status banner + altitude strip stay visible for the essentials.
 */

import { AltitudeStrip } from "./AltitudeStrip";
import { AttitudeIndicator } from "./AttitudeIndicator";
import { FuelAndThrottle } from "./FuelAndThrottle";
import { SimStatusBanner } from "./SimStatusBanner";
import { TowerProximity } from "./TowerProximity";
import { useHudStore } from "../state/hudStore";

export function Hud() {
  const mode = useHudStore((s) => s.mode);
  if (mode === "off") return null;

  return (
    <>
      <SimStatusBanner />
      <AltitudeStrip />
      {mode === "full" && (
        <>
          <FuelAndThrottle />
          <div className="hidden sm:block">
            <AttitudeIndicator />
          </div>
          <div className="hidden sm:block">
            <TowerProximity />
          </div>
        </>
      )}
    </>
  );
}
