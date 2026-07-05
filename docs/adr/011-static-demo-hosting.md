# ADR-011: Static demo hosting on GitHub Pages, MPC degraded by build flag

- **Status:** Accepted
- **Date:** 2026-07-05
- **Tickets:** SLS-49 (deploy pulled forward from M7); relates to ADR-008 (WASM MPC)

## Context

The v1 cut line (M0–M4) and the M5 MPC stack shipped; the owner pulled the
public deploy forward to get a URL early and de-risk M7 hosting. The web
app (`apps/web`, Vite + React + R3F) is fully client-side **except** MPC
guidance, which needs the Python SOCP service (`services/mpc`) that a
static host cannot run.

## Decision

**Host:** GitHub Pages via Actions (`deploy.yml`, push-to-`main` +
`workflow_dispatch`). Free, no new accounts or secrets, artifact →
`deploy-pages`. Alternatives (Cloudflare Pages, Netlify, Vercel) were
rejected: each adds an account + token for zero benefit on a static SPA.

**Base path:** project Pages serve under `/<repo>/`, so the deploy build
sets `VITE_BASE_PATH=/starship-catch-sim/`; `vite.config.ts` reads it with
a `?? "/"` fallback so dev, `vite preview`, and the Playwright e2e job
(baseURL at root) are unaffected. `index.html` is copied to `404.html` as
an SPA fallback.

**MPC degradation — build-time flag, not runtime catch:** the deploy build
sets `VITE_MPC_URL=""`. `sim/mpcService.ts` resolves it to `null`
(`MPC_SERVICE_DISABLED`); `useSimRunner` then injects a transport that
*rejects without touching the network*, so the browser logs **no**
`net::ERR_CONNECTION_REFUSED`, and the already-tested PID-fallback path
flies the vehicle. A banner (`<MpcServiceBanner>`) and a `(local)` marker
on the MPC dropdown option explain the state and link the README's
"Running MPC locally" section. MPC stays visible and selectable per the
ticket.

Resolution table for `VITE_MPC_URL`: unset → `http://localhost:8100`
(dev); `""` → disabled (static host); any URL → verbatim.

## Why build-time and not a runtime health probe

A health probe (`fetch(/health)` on MPC select) would itself emit one
uncatchable browser console error when the service is absent — violating
the "no console errors" acceptance criterion. A build-time flag is
deterministic and produces exactly zero network activity on the demo.

## Consequences

- **Positive:** free hosting; the CI e2e job builds with `VITE_MPC_URL=""`,
  so it validates the *actual* production configuration (a new
  `mpc-degrade.spec.ts` asserts banner + zero `/solve` requests + zero
  console errors, self-skipping on service-enabled builds).
- **Negative / accepted:** the deploy workflow rebuilds independently of
  the CI workflow rather than reusing its artifact — simpler, at the cost
  of one extra build on `main` (a push to `main` only happens post-merge,
  when CI was already green on the PR). Dev-mode MPC with the service
  *unintentionally* down still spams the console (pre-existing, out of
  scope) — only the static build is guaranteed clean.
- **Follow-up:** the real fix that makes MPC work on the static host is
  the WebAssembly port (ADR-008 / SLS-31); until then the demo is
  PID-capable only. Sandbox dev routes (`/sandbox/*`) are not base-path
  aware and aren't linked from the demo (dev-only).

## Enablement note

Pages was not yet enabled on the repo; `configure-pages@v5` with
`enablement: true` flips it on from the workflow. If org/repo policy blocks
programmatic enablement, the owner enables it once
(Settings → Pages → Source: GitHub Actions).
