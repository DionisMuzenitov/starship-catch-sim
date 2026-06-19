/**
 * Scenario picker — small `<select>` overlay in the top-left. Picks
 * difficulty before a flight. Changing scenario re-mounts `<Scene />`
 * (via `key={scenarioId}` in App), so `useSimRunner` rebuilds the
 * runner cleanly from the new IC.
 *
 * Adjacent "Load replay" button accepts a `.json` file and switches into
 * replay mode. The select is disabled while a replay is playing so the
 * scenario can't drift out from under the recorded frames.
 */

import { useRef, useState } from "react";

import { SCENARIOS } from "@starship-catch-sim/physics";

import { readReplayFile } from "../replay/replayIO";
import { useReplayStore } from "../state/replayStore";
import { useScenarioStore } from "../state/scenarioStore";

export function ScenarioPicker() {
  const currentScenarioId = useScenarioStore((s) => s.currentScenarioId);
  const setScenarioId = useScenarioStore((s) => s.setScenarioId);
  const replayMode = useReplayStore((s) => s.mode);
  const enterReplay = useReplayStore((s) => s.enterReplay);
  const inputRef = useRef<HTMLInputElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function onFile(file: File | null | undefined) {
    if (!file) return;
    setLoadError(null);
    try {
      const replay = await readReplayFile(file);
      enterReplay(replay);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }

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
        className="rounded bg-black/0 text-white outline-none disabled:opacity-40"
        value={currentScenarioId}
        onChange={(e) => setScenarioId(e.target.value)}
        disabled={replayMode === "replay"}
      >
        {SCENARIOS.map((s) => (
          <option key={s.id} value={s.id} className="bg-neutral-900">
            {s.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="ml-2 rounded bg-white/10 px-2 py-[2px] text-[10px] uppercase tracking-wider text-white/90 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => inputRef.current?.click()}
        disabled={replayMode === "replay"}
        data-testid="scenario-load-replay"
      >
        Load replay
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        data-testid="scenario-load-replay-input"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          // Reset the input so loading the same file twice still fires
          // onChange the second time.
          e.target.value = "";
        }}
      />
      {loadError !== null && (
        <div
          className="mt-1 max-w-xs text-[10px] text-rose-300"
          data-testid="scenario-load-error"
        >
          {loadError}
        </div>
      )}
    </div>
  );
}
