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

/** How long to wait for the health-ping before declaring the service down. */
export const MPC_HEALTH_TIMEOUT_MS = 2000;

/**
 * One-shot reachability check for the MPC guidance service (SLS-92): a `GET
 * /health` that resolves `true` when the service answers and `false` on any
 * failure (connection refused, non-2xx, or timeout). Never throws — the caller
 * gets a plain boolean it can push to the store.
 *
 * Used at MPC-selection time so the app can show the degradation banner in dev
 * (service not running) rather than silently flying the PID fallback with only
 * per-second connection errors in the console. `fetchImpl` is injectable for
 * tests; production passes the global `fetch`.
 */
export async function pingMpcHealth(
  serviceUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = MPC_HEALTH_TIMEOUT_MS,
): Promise<boolean> {
  // An explicit controller + cleared timer (rather than AbortSignal.timeout)
  // so no abort timer lingers after the request resolves — otherwise every
  // ping leaves a timer armed for the full timeout, which surfaces as an
  // open-handle warning in tests and needless scheduled work in the app.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetchImpl(`${serviceUrl}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decide whether a resolved health-ping should raise the "service unreachable"
 * banner (SLS-92). Kept pure so the reconciliation rules the code review
 * flagged are directly testable:
 *   - `cancelled`  — the session was torn down / MPC re-selected before the
 *                    ping resolved; a stale result must not clobber it.
 *   - `reachable`  — the ping succeeded; nothing to flag.
 *   - `usingFallback` — if MPC is already steering when the ping resolves, the
 *                    service is demonstrably up, so a slow or 404 `/health` is
 *                    not evidence to the contrary.
 */
export function shouldFlagUnreachable(args: {
  cancelled: boolean;
  reachable: boolean;
  usingFallback: boolean;
}): boolean {
  return !args.cancelled && !args.reachable && args.usingFallback;
}
