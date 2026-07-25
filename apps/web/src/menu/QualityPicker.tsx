/**
 * Quality-tier picker + perf-HUD toggle (SLS-61). Small overlay under the
 * controller row. The tier drives the renderer pixel ratio (see `qualityStore`);
 * the perf checkbox shows the frame-time HUD — on by default (owner preference),
 * persisted, uncheck for a clean capture.
 */

import {
  QUALITY_TIERS,
  useQualityStore,
  type QualityTier,
} from "../state/qualityStore";

export function QualityPicker() {
  const tier = useQualityStore((s) => s.tier);
  const setTier = useQualityStore((s) => s.setTier);
  const perfHud = useQualityStore((s) => s.perfHud);
  const togglePerfHud = useQualityStore((s) => s.togglePerfHud);

  return (
    <div
      className="absolute left-3 top-28 z-10 flex items-center gap-2 select-none rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] text-white/90"
      data-testid="quality-picker"
    >
      <label htmlFor="quality" className="opacity-70">
        quality:
      </label>
      <select
        id="quality"
        className="rounded bg-black/0 text-white outline-none"
        value={tier}
        onChange={(e) => setTier(e.target.value as QualityTier)}
      >
        {QUALITY_TIERS.map((t) => (
          <option key={t} value={t} className="bg-neutral-900">
            {t}
          </option>
        ))}
      </select>
      <label className="ml-1 flex cursor-pointer items-center gap-1 opacity-80">
        <input
          type="checkbox"
          checked={perfHud}
          onChange={togglePerfHud}
          className="accent-white/80"
        />
        perf
      </label>
    </div>
  );
}
