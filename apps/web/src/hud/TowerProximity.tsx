import { useHudStore } from "../state/hudStore";
import { useSimStore } from "../state/simStore";

import { formatBearing, formatLength } from "./formatters";
import { towerProximity } from "./physicsDerived";

export function TowerProximity() {
  const world = useSimStore((s) => s.world);
  const units = useHudStore((s) => s.units);
  const p = towerProximity(world);
  return (
    <div
      className="pointer-events-none absolute bottom-3 right-3 select-none rounded-md bg-black/55 px-3 py-2 font-mono text-xs leading-tight text-white/90"
      data-testid="hud-tower"
    >
      <div className="text-[10px] uppercase opacity-60">tower 3d / horiz</div>
      <div>{formatLength(p.dist3d, units, 0)}</div>
      <div>{formatLength(p.distHoriz, units, 0)}</div>
      <div className="mt-1 text-[10px] uppercase opacity-60">bearing</div>
      <div>{formatBearing(p.bearingRad)}</div>
    </div>
  );
}
