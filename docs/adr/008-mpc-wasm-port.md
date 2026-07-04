# ADR-008: MPC in the browser — WASM port plan

- **Status:** Accepted
- **Date:** 2026-07-04
- **Tickets:** SLS-27 (this ADR), SLS-26 (HTTP service being evaluated), SLS-31 (hosted demo — the trigger)

## Context

ADR-007's guidance loop runs as a Python HTTP service (CVXPY + Clarabel,
SLS-26). That is fine for local development (`pnpm dev:full`) but a hosted
demo (M7 / SLS-31) would need either a paid always-on solver backend or a
browser-native solver. The question: which WASM path, and when.

The workload is fixed and small: one SOCP with N = 60 nodes, ~430 scalar
variables, ~1 000 constraints, re-solved at 1 Hz with only parameter values
changing (the DPP pattern from SLS-26 — the sparsity structure never
changes between calls). Native Clarabel solves it in ~5–15 ms.

## Options

1. **Clarabel.rs → wasm32** (github.com/oxfordcontrol/Clarabel.rs). The
   same interior-point implementation CVXPY calls, natively in Rust —
   `wasm-pack` build with the `sdp` features off. No published WASM
   artifact exists as of 2026-06, so we would own the build. Expected
   solve cost 1.5–3× native → 10–45 ms at N=60: comfortably inside a 1 Hz
   budget. Bundle ≈ 1–2 MB (acceptable, lazy-loaded only when the MPC
   controller is selected). **Preferred.**
2. **ECOS via emscripten.** Plain C, the easiest toolchain, and old
   JS ports exist as prior art. Algorithmically older (no equilibration
   improvements, weaker on marginal problems) and our ECOS fallback
   already sees occasional `optimal_inaccurate` on hard ICs. Fallback
   option if the Clarabel build fights us.
3. **OSQP-wasm.** Exists and is maintained — but OSQP solves QPs, not
   SOCPs. Reformulating the pointing/glide cones via polyhedral
   approximation degrades exactly the constraints the project showcases.
   **Rejected.**
4. **Stay HTTP forever.** Zero build work, but a hosted demo then needs a
   running Python backend (cost, cold starts, abuse surface). Acceptable
   for M5/M6; wrong endpoint for M7's "static hosting + leaderboard"
   shape.

## Decision

**Stay HTTP through M5 and M6. Port to Clarabel.rs-WASM as part of M7
(SLS-31) — triggered by the hosted-demo requirement, not before.**

How the port keeps the SLS-26 architecture:

- The parametric-problem pattern survives: the browser stamps parameter
  values into pre-built CSC sparse matrices (`P`, `A`, `q`, `b`, cone
  spec) exactly where CVXPY's DPP layer does today. We freeze the
  canonicalized matrix layout once (export it from CVXPY with
  `problem.get_problem_data(solver=cp.CLARABEL)`) and generate a small TS
  stamping module from it — no CVXPY in the browser.
- `MPCController`'s injectable `transport` becomes the seam: a
  `wasmTransport` implementing the same `MPCSolveRequest → MPCSolveResponse`
  contract slots in beside the HTTP transport; the fallback logic,
  cadence, and overlay code don't change at all.
- The Python service stays canonical for benchmarks and SCvx research;
  the WASM build is a deployment target, verified against the service by
  replaying identical requests and comparing trajectories (tolerance
  ~1e-6 — same algorithm, same data).

## Consequences

- `services/mpc` remains the source of truth for the formulation; any
  constraint change must regenerate the frozen matrix layout for the WASM
  path once it exists.
- A `crates/mpc-wasm` stretch crate (per the ticket) is explicitly
  deferred to SLS-31 scope.
- Solve-time benchmarks (SLS-27 bench suite) establish today's native
  baseline; the port must land within 3× of it to keep the 1 Hz cadence
  with margin.

## Sources

- Clarabel.rs: https://github.com/oxfordcontrol/Clarabel.rs (accessed 2026-07-04)
- CVXPY canonical problem-data export: https://www.cvxpy.org/api_reference/cvxpy.problems.html
- ECOS: https://github.com/embotech/ecos (accessed 2026-07-04)
- OSQP: https://osqp.org (QP scope — accessed 2026-07-04)
