/**
 * Degradation notice for the public static demo (SLS-49). Shows only when
 * MPC is the active controller AND the guidance service is declared absent
 * (`VITE_MPC_URL=""`). The sim keeps flying the PID fallback with no
 * network calls; this explains why and links the local-run instructions.
 */

import { useControllerStore } from "../state/controllerStore";
import { useMpcStore } from "../state/mpcStore";

const README_MPC_URL =
  "https://github.com/DionisMuzenitov/starship-catch-sim#running-mpc-locally";

export function MpcServiceBanner() {
  const kind = useControllerStore((s) => s.kind);
  const serviceDisabled = useMpcStore((s) => s.serviceDisabled);

  if (kind !== "mpc" || !serviceDisabled) return null;

  return (
    <div
      className="absolute left-1/2 top-3 z-20 max-w-md -translate-x-1/2 rounded-md border border-amber-400/40 bg-black/75 px-3 py-2 text-center font-mono text-[11px] leading-snug text-amber-100"
      data-testid="mpc-service-banner"
      role="status"
    >
      <span aria-hidden className="mr-1">
        ⓘ
      </span>
      MPC guidance needs the local Python service — flying the PID baseline
      instead.{" "}
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
