import {
  BoosterDescentStandard,
  scenarioById,
  type EngineGroup,
} from "@starship-catch-sim/physics";

import { useHudStore } from "../state/hudStore";
import { useScenarioStore } from "../state/scenarioStore";
import { useSimStore } from "../state/simStore";

import { formatMass, formatPercent } from "./formatters";
import {
  fuelFraction,
  groupAnyOn,
  groupThrottle,
  propellantMass,
} from "./physicsDerived";

const ALL_GROUPS: readonly { key: EngineGroup; label: string }[] = [
  { key: "centre", label: "C" },
  { key: "inner", label: "I" },
  { key: "outer", label: "O" },
  { key: "ship", label: "S" },
];

export function FuelAndThrottle() {
  const world = useSimStore((s) => s.world);
  const units = useHudStore((s) => s.units);
  const scenarioId = useScenarioStore((s) => s.currentScenarioId);
  const vehicle =
    (scenarioById(scenarioId) ?? BoosterDescentStandard).vehicle;
  const fuel = fuelFraction(world);
  // Only show meters for groups the active vehicle actually populates,
  // and only when the world payload matches the vehicle shape (avoids
  // out-of-bounds reads during a scenario switch).
  const shapesMatch = world.engineStates.length === vehicle.engines.length;
  const groups = shapesMatch
    ? ALL_GROUPS.filter((g) => vehicle.engineGroupOf.includes(g.key))
    : [];

  return (
    <div
      className="pointer-events-none absolute right-3 top-3 select-none rounded-md bg-black/55 px-3 py-2 font-mono text-xs leading-tight text-white/90"
      data-testid="hud-fuel"
    >
      <div className="text-[10px] uppercase opacity-60">propellant</div>
      <div>{formatMass(propellantMass(world), units)}</div>
      <div className="mt-1 h-1.5 w-32 overflow-hidden rounded bg-white/15">
        <div
          className={`h-full ${fuel > 0.2 ? "bg-emerald-400/80" : "bg-red-400/80"}`}
          style={{ width: `${Math.max(0, Math.min(1, fuel)) * 100}%` }}
        />
      </div>
      <div className="mt-2 flex items-end gap-3">
        {groups.map((g) => {
          const t = groupThrottle(world, vehicle, g.key);
          const on = groupAnyOn(world, vehicle, g.key);
          return (
            <div key={g.key} className="flex flex-col items-center">
              <div className="relative h-12 w-3 rounded bg-white/15">
                <div
                  className={`absolute bottom-0 w-full rounded ${on ? "bg-amber-300/90" : "bg-white/30"}`}
                  style={{ height: `${Math.max(0, Math.min(1, t)) * 100}%` }}
                />
              </div>
              <div className="mt-0.5 text-[10px] opacity-70">{g.label}</div>
              <div
                className={`mt-0.5 h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-400" : "bg-white/20"}`}
              />
              <div className="text-[9px] opacity-60">{formatPercent(t)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
