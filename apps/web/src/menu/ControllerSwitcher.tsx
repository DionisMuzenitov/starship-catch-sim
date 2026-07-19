/**
 * Top-bar controller picker (Manual / PID / MPC / RL) plus a temp/hard
 * toggle that decides how manual takeover behaves during an auto-fly
 * run. MPC and RL are visible but disabled until SLS-25+ / SLS-28+
 * ship their controllers, so the dropdown reflects the M3/M4 roadmap.
 *
 * Switching `kind` re-mounts the Scene via the App-level key, so the
 * runner rebuilds with the new controller and the current flight resets.
 */

import { MPC_SERVICE_DISABLED } from "../sim/mpcService";
import {
  PLACEHOLDER_KINDS,
  useControllerStore,
  type ControllerKind,
  type OverrideMode,
} from "../state/controllerStore";

const KIND_LABELS: { kind: ControllerKind; label: string }[] = [
  { kind: "manual", label: "Manual" },
  { kind: "pid", label: "PID" },
  { kind: "mpc", label: "MPC" },
  { kind: "rl", label: "RL" },
];

const MODE_LABELS: { mode: OverrideMode; label: string; title: string }[] = [
  {
    mode: "temporary",
    label: "temp",
    title: "Manual key takes over for ~2 s, then auto resumes",
  },
  {
    mode: "hard",
    label: "hard",
    title: "Any manual key hands the stick to you for the rest of the run",
  },
];

export function ControllerSwitcher() {
  const kind = useControllerStore((s) => s.kind);
  const setKind = useControllerStore((s) => s.setKind);
  const overrideMode = useControllerStore((s) => s.overrideMode);
  const setOverrideMode = useControllerStore((s) => s.setOverrideMode);
  const overrideActive = useControllerStore((s) => s.overrideActive);
  const isManual = kind === "manual";

  return (
    <div
      className="absolute left-3 top-20 z-10 select-none rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] text-white/90"
      data-testid="controller-switcher"
    >
      <span className="mr-2 opacity-70">controller:</span>
      <select
        className="rounded bg-black/40 px-1 py-[1px] text-[11px] outline-none"
        value={kind}
        onChange={(e) => setKind(e.target.value as ControllerKind)}
        data-testid="controller-switcher-select"
      >
        {KIND_LABELS.map((k) => (
          <option
            key={k.kind}
            value={k.kind}
            disabled={PLACEHOLDER_KINDS.includes(k.kind)}
            className="bg-neutral-900"
          >
            {k.label}
            {PLACEHOLDER_KINDS.includes(k.kind) ? " (soon)" : ""}
            {/* On the public demo MPC has no guidance service; it stays
                selectable (flies PID + shows a banner) but is marked. */}
            {k.kind === "mpc" && MPC_SERVICE_DISABLED ? " (local)" : ""}
          </option>
        ))}
      </select>
      {!isManual && (
        <>
          <span className="ml-3 mr-1 opacity-70">override:</span>
          {MODE_LABELS.map((m) => (
            <button
              key={m.mode}
              type="button"
              title={m.title}
              onClick={() => setOverrideMode(m.mode)}
              className={`mr-1 rounded px-2 py-[2px] text-[10px] uppercase tracking-wider ${
                overrideMode === m.mode
                  ? "bg-emerald-500/40 text-white"
                  : "bg-white/10 text-white/80 hover:bg-white/20"
              }`}
              data-testid={`controller-override-${m.mode}`}
            >
              {m.label}
            </button>
          ))}
          {overrideActive && (
            <span
              className="ml-2 rounded bg-rose-500/40 px-2 py-[2px] text-[10px] uppercase tracking-wider text-white"
              data-testid="controller-override-active"
            >
              YOU
            </span>
          )}
        </>
      )}
    </div>
  );
}
