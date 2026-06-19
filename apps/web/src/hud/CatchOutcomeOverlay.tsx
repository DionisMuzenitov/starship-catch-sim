/**
 * Post-attempt outcome panel. Subscribes to `simStore.outcome`; renders a
 * full-screen translucent overlay with the verdict banner + terminal
 * metrics when a non-`null` outcome is present. Renders nothing while the
 * rocket is still in flight.
 *
 * The "Reset" button re-emits the active scenario id through
 * `scenarioStore.setScenarioId`. `<App>` keys `<Scene>` on that id so the
 * setter triggers a full scene remount — same code path used by the
 * scenario picker, so a fresh runner + cleared outcome state fall out
 * automatically. Re-setting the id only triggers a remount if it changes,
 * so we briefly clear it to force re-mount on the same scenario.
 */

import type { CatchOutcomeKind } from "@starship-catch-sim/physics";

import { downloadReplay } from "../replay/replayIO";
import { useHudStore } from "../state/hudStore";
import { useScenarioStore } from "../state/scenarioStore";
import { useSimStore } from "../state/simStore";

import {
  formatAngleDeg,
  formatLength,
  formatMass,
  formatSpeed,
} from "./formatters";

const KIND_BANNER: Record<CatchOutcomeKind, { label: string; tone: string }> = {
  caught: { label: "CAUGHT", tone: "text-emerald-300" },
  near_miss: { label: "NEAR MISS", tone: "text-amber-300" },
  tower_collision: { label: "TOWER HIT", tone: "text-rose-400" },
  crash: { label: "CRASH", tone: "text-rose-400" },
  none: { label: "—", tone: "text-white" },
};

export function CatchOutcomeOverlay() {
  const outcome = useSimStore((s) => s.outcome);
  const setOutcome = useSimStore((s) => s.setOutcome);
  const lastReplay = useSimStore((s) => s.lastReplay);
  const units = useHudStore((s) => s.units);
  const resetCurrent = useScenarioStore((s) => s.resetCurrent);

  if (outcome === null) return null;

  const banner = KIND_BANNER[outcome.kind];
  const { metrics, verdict } = outcome;

  function resetScenario() {
    setOutcome(null);
    resetCurrent();
  }

  function saveReplay() {
    if (lastReplay === null) return;
    downloadReplay(lastReplay);
  }

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-testid="catch-outcome-overlay"
      data-outcome-kind={outcome.kind}
    >
      <div className="w-[min(28rem,90vw)] rounded-xl border border-white/15 bg-zinc-900/85 p-6 font-mono text-sm text-white/90 shadow-2xl">
        <div
          className={`mb-4 text-center text-3xl font-semibold tracking-wider ${banner.tone}`}
          data-testid="catch-outcome-banner"
        >
          {banner.label}
        </div>
        {verdict !== undefined && (
          <div className="mb-4 text-center text-xs text-white/70">
            {verdict.reason}
          </div>
        )}
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
          <Row label="Δ to target">
            {formatLength(metrics.distanceToTargetM, units, 2)}
          </Row>
          <Row label="v_y">
            {formatSpeed(metrics.verticalSpeedMps, units, 2)}
          </Row>
          <Row label="v_h">
            {formatSpeed(metrics.horizontalSpeedMps, units, 2)}
          </Row>
          <Row label="tilt">{formatAngleDeg(metrics.tiltRad, 1)}</Row>
          <Row label="|ω|">
            {`${metrics.angularRateMagRadPerS.toFixed(3)} rad/s`}
          </Row>
          <Row label="fuel left">{formatMass(metrics.fuelRemainingKg, units)}</Row>
        </dl>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={resetScenario}
            className="rounded-md bg-white/10 px-3 py-2 text-xs uppercase tracking-wider text-white/90 hover:bg-white/20"
            data-testid="catch-outcome-reset"
          >
            Reset scenario
          </button>
          <button
            type="button"
            onClick={saveReplay}
            disabled={lastReplay === null}
            className="rounded-md bg-white/10 px-3 py-2 text-xs uppercase tracking-wider text-white/90 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="catch-outcome-save-replay"
          >
            Save replay
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-white/55">{label}</dt>
      <dd className="text-right text-white/90">{children}</dd>
    </>
  );
}
