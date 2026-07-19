# ADR-021: VitePress docs site, nested into the Pages artifact

- **Status:** Accepted
- **Date:** 2026-07-19
- **Tickets:** SLS-32

## Context

The project had a pile of authoritative markdown (dynamics derivation, RL reward
design, 20 ADRs, reference data, a committed benchmark report) but no browsable
home — everything was read raw on GitHub. SLS-32 asked for a public docs site:
physics + controller explainers, an auto-listed ADR index, benchmarks, and a
"write your own controller" API page. The ticket named VitePress, KaTeX, an
iframe-embedded live demo, a CodeSandbox for the example, and a `pnpm report`
generator feeding the benchmarks page.

Two hard constraints shaped the build: (1) the demo already deploys as a
**single GitHub Pages artifact** (`apps/web/dist`) under base
`/starship-catch-sim/` (ADR-011 / SLS-49) — Pages publishes one artifact; and
(2) several things the ticket referenced don't exist: `docs/mpc.md`, a
`pnpm report` script, and any LaTeX in the docs (equations are fenced-code +
Unicode).

## Decision

Stand up **VitePress** in `docs/` (a real pnpm workspace member) and **nest its
build into the existing Pages artifact** at `apps/web/dist/docs` — the app stays
at the repo root, the docs live at `/docs`, one artifact, one deploy job. The
docs build runs with `DOCS_BASE_PATH=/starship-catch-sim/docs/`.

- **ADR index auto-lists** from a filesystem walk of `adr/*.md` in the VitePress
  config (parsing the `# ADR-NNN:` heading), satisfying the "no hand-maintained
  list" AC.
- **Benchmarks** are single-sourced: a `sync-report.mjs` prebuild copies the
  committed `eval/reports/v1-controller-comparison.md` into a gitignored
  `docs/benchmarks.md`, rewriting its repo-relative links to absolute GitHub
  URLs so they resolve on the hosted site.
- **Search** uses VitePress's built-in local (MiniSearch) provider.
- **Math** is enabled via VitePress's first-class MathJax3 plugin (see below).

## Consequences

- **Positive:** one artifact / one deploy; the ADR index can never drift; the
  benchmark page tracks the canonical report automatically; the API page ships a
  compile-checked 30-line `Controller` example against the real types.
- **Negative:** the docs build is coupled to the web deploy job (a docs build
  failure blocks the deploy) — acceptable, since we want both to ship together.
  Also, GitHub Pages supports only one top-level `404.html`, so an unresolved
  `/docs/*` deep link falls back to the app SPA shell rather than a docs-styled
  404 — a minor edge inherent to single-artifact Pages hosting (ADR-011).
- **Deviations from the ticket (deliberate):**
  - **KaTeX → MathJax3.** No doc uses LaTeX today, so live math is future-proofing;
    VitePress's first-class math plugin is MathJax3. Same client-side typeset role,
    swap-able if we ever need KaTeX exactly.
  - **No `pnpm report` generator.** The benchmark report is a committed artifact
    (SLS-30); building a generator is out of scope. The page syncs the committed
    file; regenerate numbers with the eval harness and refresh it.
  - **Links, not iframes, for the live demo**, and a copy-paste example instead of
    a CodeSandbox — the packages are workspace-internal (unpublished), so a live
    sandbox importing `@starship-catch-sim/physics` can't resolve; and iframing a
    heavy WebGL app into the docs is wasteful. Both are cheap to add later if the
    packages get published.
  - **`docs/mpc.md` didn't exist** — the MPC page summarizes and links the
    authoritative ADRs (007/008/009) rather than inventing a derivation.

## Alternatives considered

- **Separate host / second Pages site (or Vercel) for docs** — rejected: a second
  deploy target and domain to manage, when nesting under the existing artifact is
  a few workflow lines and keeps one URL surface.
- **Astro Starlight** — comparable, but VitePress was named in the ticket, is
  already a Vite/Vue-adjacent stack the repo tolerates, and its built-in local
  search + math cover the ACs with zero extra infrastructure.
- **Rename the `README.md` section indexes to `index.md`** — rejected: those
  files are also rendered on GitHub; instead VitePress `rewrites` map
  `adr/README.md` → `/adr/` and `reference/README.md` → `/reference/`.
