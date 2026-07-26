/**
 * Live MPC steering indicator (SLS-92). While MPC is the active controller and
 * a service is actually reachable, shows moment-to-moment whether the MPC plan
 * is steering the vehicle or the PID fallback has the stick:
 *   - steering      — an accepted plan is being tracked (emerald)
 *   - PID fallback  — no usable plan right now: the ~1 s before the first solve
 *                     lands, a divergence-abort, or a mid-flight service death
 *                     (amber)
 *
 * The value is pushed by the controller's fallback observer on every
 * transition (see `useSimRunner`), because the plan observer alone only fires
 * when a plan lands and so can never report the no-plan (service-down) case.
 * When the service is absent entirely (`serviceDisabled` / `serviceUnreachable`)
 * the louder <MpcServiceBanner> owns the message and this badge stays hidden to
 * avoid a double signal.
 */

import { useControllerStore } from "../state/controllerStore";
import { useMpcStore } from "../state/mpcStore";

export function MpcFallbackBadge() {
  const kind = useControllerStore((s) => s.kind);
  const usingFallback = useMpcStore((s) => s.usingFallback);
  const serviceDisabled = useMpcStore((s) => s.serviceDisabled);
  const serviceUnreachable = useMpcStore((s) => s.serviceUnreachable);

  if (kind !== "mpc" || serviceDisabled || serviceUnreachable) return null;

  const steering = !usingFallback;
  return (
    <div
      className={`absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] leading-none ${
        steering
          ? "border-emerald-400/40 bg-black/70 text-emerald-200"
          : "border-amber-400/40 bg-black/70 text-amber-100"
      }`}
      data-testid="mpc-fallback-badge"
      data-steering={steering ? "true" : "false"}
      role="status"
    >
      <span aria-hidden>{steering ? "●" : "○"}</span>
      <span>MPC</span>
      <span className="opacity-80">
        {steering ? "steering" : "PID fallback"}
      </span>
    </div>
  );
}
