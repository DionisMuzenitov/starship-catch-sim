/**
 * Compact top-centre banner replacing SLS-19's `SimStatusChip`. Shows
 * pause + time-scale + camera mode + sim time. Survives in `minimal`
 * HUD mode because it's the smallest piece of always-on context the
 * pilot needs.
 */

import { currentPhase, scenarioById } from "@starship-catch-sim/physics";

import { useCameraStore } from "../state/cameraStore";
import { useHudStore } from "../state/hudStore";
import { useScenarioStore } from "../state/scenarioStore";
import { useSimStore } from "../state/simStore";

export function SimStatusBanner() {
  const paused = useSimStore((s) => s.paused);
  const scale = useSimStore((s) => s.scale);
  const t = useSimStore((s) => s.t);
  const world = useSimStore((s) => s.world);
  const camMode = useCameraStore((s) => s.mode);
  const hudMode = useHudStore((s) => s.mode);
  const units = useHudStore((s) => s.units);
  const scenarioId = useScenarioStore((s) => s.currentScenarioId);
  const scenario = scenarioById(scenarioId);
  const phase = currentPhase(world);
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 select-none rounded-md bg-black/55 px-3 py-1 font-mono text-[11px] text-white/90"
      data-testid="hud-status-banner"
    >
      <span className={paused ? "text-amber-300" : ""}>
        {paused ? "PAUSED" : "RUNNING"}
      </span>
      <span className="mx-2 opacity-40">·</span>×{scale}
      <span className="mx-2 opacity-40">·</span>cam: {camMode}
      <span className="mx-2 opacity-40">·</span>t = {t.toFixed(2)} s
      <span className="mx-2 opacity-40">·</span>
      <span className="text-amber-200/90">
        {scenario?.name ?? scenarioId}
      </span>
      <span className="mx-2 opacity-40">·</span>phase: {phase}
      <span className="mx-2 opacity-40">·</span>
      <span className="opacity-70">
        H hud {hudMode} · U units {units}
      </span>
    </div>
  );
}
