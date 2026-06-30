/**
 * Tiny Manual ↔ PID toggle in the top-left HUD strip. Switching kind
 * re-mounts <Scene/> via the App-level key, so the runner is rebuilt
 * with a fresh controller and the existing flight is reset.
 */

import { useControllerStore, type ControllerKind } from "../state/controllerStore";

const OPTIONS: { kind: ControllerKind; label: string }[] = [
  { kind: "manual", label: "Manual" },
  { kind: "pid", label: "PID" },
];

export function ControllerSwitcher() {
  const kind = useControllerStore((s) => s.kind);
  const setKind = useControllerStore((s) => s.setKind);
  return (
    <div
      className="absolute left-3 top-24 z-10 select-none rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] text-white/90"
      data-testid="controller-switcher"
    >
      <span className="mr-2 opacity-70">controller:</span>
      {OPTIONS.map((o) => (
        <button
          key={o.kind}
          type="button"
          onClick={() => setKind(o.kind)}
          className={`mr-1 rounded px-2 py-[2px] text-[10px] uppercase tracking-wider ${
            kind === o.kind ? "bg-emerald-500/40 text-white" : "bg-white/10 text-white/80 hover:bg-white/20"
          }`}
          data-testid={`controller-switcher-${o.kind}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
