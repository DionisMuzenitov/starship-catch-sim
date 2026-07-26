/**
 * Degradation notice shown when MPC is the active controller but no guidance
 * service is actually flying it — so the sim is on its PID fallback. Two
 * causes, one banner (SLS-49 + SLS-92):
 *   - `serviceDisabled`   — static-host build (`VITE_MPC_URL=""`); the service
 *                           can't exist here. No network calls are made.
 *   - `serviceUnreachable` — a live service URL was configured but a health-
 *                           ping failed: it just isn't running (dev without
 *                           `pnpm dev:full`).
 * Without this, selecting MPC silently flew the PID baseline with only
 * per-second connection errors in the console — the bug SLS-92 repaired.
 */

import { useControllerStore } from "../state/controllerStore";
import { useMpcStore } from "../state/mpcStore";

const README_MPC_URL =
  "https://github.com/DionisMuzenitov/starship-catch-sim#running-mpc-locally";

export function MpcServiceBanner() {
  const kind = useControllerStore((s) => s.kind);
  const serviceDisabled = useMpcStore((s) => s.serviceDisabled);
  const serviceUnreachable = useMpcStore((s) => s.serviceUnreachable);

  if (kind !== "mpc" || !(serviceDisabled || serviceUnreachable)) return null;

  // `serviceDisabled` (the build can't host the service) takes precedence over
  // a runtime unreachable-ping when both are somehow set.
  const message = serviceDisabled
    ? "MPC guidance needs the local Python service — flying the PID baseline instead."
    : "MPC service unreachable — flying the PID baseline. Start it with pnpm dev:full.";

  return (
    <div
      className="absolute left-1/2 top-3 z-20 max-w-md -translate-x-1/2 rounded-md border border-amber-400/40 bg-black/75 px-3 py-2 text-center font-mono text-[11px] leading-snug text-amber-100"
      data-testid="mpc-service-banner"
      role="status"
    >
      <span aria-hidden className="mr-1">
        ⓘ
      </span>
      {message}{" "}
      <a
        href={README_MPC_URL}
        target="_blank"
        rel="noreferrer"
        className="underline decoration-amber-300/60 underline-offset-2 hover:text-white"
      >
        Running MPC locally →
      </a>
    </div>
  );
}
