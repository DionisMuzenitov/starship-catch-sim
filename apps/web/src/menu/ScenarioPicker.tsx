/**
 * Scenario picker — small `<select>` overlay in the top-left. Picks
 * difficulty before a flight. Changing scenario re-mounts `<Scene />`
 * (via `key={scenarioId}` in App), so `useSimRunner` rebuilds the
 * runner cleanly from the new IC.
 */

import { SCENARIOS } from "@starship-catch-sim/physics";

import { useScenarioStore } from "../state/scenarioStore";

export function ScenarioPicker() {
  const currentScenarioId = useScenarioStore((s) => s.currentScenarioId);
  const setScenarioId = useScenarioStore((s) => s.setScenarioId);
  return (
    <div
      className="absolute left-3 top-12 z-10 select-none rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] text-white/90"
      data-testid="scenario-picker"
    >
      <label htmlFor="scenario" className="mr-2 opacity-70">
        scenario:
      </label>
      <select
        id="scenario"
        className="rounded bg-black/0 text-white outline-none"
        value={currentScenarioId}
        onChange={(e) => setScenarioId(e.target.value)}
      >
        {SCENARIOS.map((s) => (
          <option key={s.id} value={s.id} className="bg-neutral-900">
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}
