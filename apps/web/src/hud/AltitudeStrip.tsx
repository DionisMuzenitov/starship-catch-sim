import {
  horizontalSpeed,
  machNumber,
  verticalSpeed,
} from "./physicsDerived";
import { useHudStore } from "../state/hudStore";
import { useSimStore } from "../state/simStore";
import {
  formatLength,
  formatMach,
  formatSpeed,
} from "./formatters";

export function AltitudeStrip() {
  const world = useSimStore((s) => s.world);
  const units = useHudStore((s) => s.units);
  const alt = world.rigidBody.position.y;
  return (
    <div
      className="pointer-events-none absolute left-3 top-20 select-none rounded-md bg-black/55 px-3 py-2 font-mono text-xs leading-tight text-white/90"
      data-testid="hud-altitude"
    >
      <div className="text-[10px] uppercase opacity-60">alt</div>
      <div>{formatLength(alt, units)}</div>
      <div className="mt-1 text-[10px] uppercase opacity-60">vy / vh</div>
      <div>{formatSpeed(verticalSpeed(world), units)}</div>
      <div>{formatSpeed(horizontalSpeed(world), units)}</div>
      <div className="mt-1 text-[10px] uppercase opacity-60">mach</div>
      <div>{formatMach(machNumber(world))}</div>
    </div>
  );
}
