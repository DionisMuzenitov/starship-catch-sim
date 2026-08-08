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

import { useState } from "react";

import { loadBundledReplay } from "../replay/replayIO";
import { useControllerStore } from "../state/controllerStore";
import { useMpcStore } from "../state/mpcStore";
import { useReplayStore } from "../state/replayStore";

const README_MPC_URL =
  "https://github.com/DionisMuzenitov/starship-catch-sim#running-mpc-locally";
/** A real MPC catch recorded under bench-valid conditions (SLS-96), bundled so
 *  the static demo can SHOW what the guidance does even without the service. */
const MPC_CATCH_REPLAY = "replays/mpc-catch-calm.json";

export function MpcServiceBanner() {
  const kind = useControllerStore((s) => s.kind);
  const serviceDisabled = useMpcStore((s) => s.serviceDisabled);
  const serviceUnreachable = useMpcStore((s) => s.serviceUnreachable);
  const enterReplay = useReplayStore((s) => s.enterReplay);
  const [replayError, setReplayError] = useState<string | null>(null);

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
      {message}
      <div className="mt-1.5 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => {
            setReplayError(null);
            loadBundledReplay(MPC_CATCH_REPLAY)
              .then(enterReplay)
              .catch((err: unknown) =>
                setReplayError((err as Error).message),
              );
          }}
          className="rounded bg-amber-400/20 px-2 py-[2px] text-[10px] uppercase tracking-wider text-amber-100 hover:bg-amber-400/30"
          data-testid="mpc-watch-recorded-catch"
        >
          ▶ Watch a recorded MPC catch
        </button>
        <a
          href={README_MPC_URL}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-amber-300/60 underline-offset-2 hover:text-white"
        >
          Running MPC locally →
        </a>
      </div>
      {replayError !== null && (
        <div className="mt-1 text-[10px] text-rose-300" data-testid="mpc-replay-error">
          Couldn&apos;t load the recorded catch: {replayError}
        </div>
      )}
    </div>
  );
}
