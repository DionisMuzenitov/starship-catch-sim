/**
 * Resolves how the web app reaches the MPC guidance service (SLS-49).
 *
 * The MPC controller needs the Python SOCP service (`services/mpc`), which
 * a static host (GitHub Pages) cannot run. Rather than let the client fire
 * per-second `fetch`es at a service that isn't there — which the browser
 * logs as uncatchable `net::ERR_CONNECTION_REFUSED` console errors — the
 * deploy build sets `VITE_MPC_URL=""` to declare the service absent up
 * front. The app then flies the PID fallback with **zero** network calls
 * and shows a banner (see `<MpcServiceBanner>`), degrading cleanly.
 *
 * Resolution of `import.meta.env.VITE_MPC_URL`:
 *   - unset (`undefined`) → local dev default `http://localhost:8100`
 *   - empty string        → service disabled (the static-host signal)
 *   - any other value     → use it verbatim (custom host / tunnel)
 */

const DEFAULT_DEV_URL = "http://localhost:8100";

export function resolveMpcServiceUrl(raw: string | undefined): string | null {
  if (raw === undefined) return DEFAULT_DEV_URL;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** The resolved base URL, or `null` when the service is declared absent. */
export const MPC_SERVICE_URL: string | null = resolveMpcServiceUrl(
  import.meta.env.VITE_MPC_URL as string | undefined,
);

/** True on builds with no guidance service (the public static demo). */
export const MPC_SERVICE_DISABLED = MPC_SERVICE_URL === null;
