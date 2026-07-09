# ADR-016: Pure-TS policy runtime (JSON weights, no ONNX)

- **Status:** Accepted
- **Date:** 2026-07-09
- **Tickets:** SLS-30
- **Supersedes:** the ONNX/onnxruntime-web plan sketched in ADR-003 and the
  SLS-30 acceptance criteria as originally written.

## Context

SLS-30 ships the neural policy to the browser. The original plan (written
when a large RL net was expected) was ONNX + `onnxruntime-web`. The policy
that actually cleared the gate is a 17→256→256→4 tanh MLP — 578 KB of
weights, ~140k multiply-adds per inference at 25 Hz.

## Decision

Ship the weights as a self-describing JSON artifact
(`apps/web/public/models/booster_policy.json`, format `sls-mlp-policy-v1`)
and execute them with a ~30-line synchronous forward pass in
`packages/controllers/src/rlController.ts`.

The artifact bundles the **entire runtime contract**, not just weights:
obs layout + normalization scales, action decode semantics (null action =
engines off), the inner-loop PD gains (K_ATT/K_RATE/LEAN_MAX/max gimbal,
ADR-015), policy cadence (10 physics ticks), and provenance. The exporter
(`services/rl/scripts/export_policy.py`) also emits a parity fixture; a
vitest asserts TS ≡ Python to 1e-4 on fixed observations and 1e-9 on the
PD law.

## Rationale

- `onnxruntime-web` costs ~20 MB of WASM and returns promises; the
  `Controller.step` contract is synchronous, forcing a cached-action
  pattern and Node-bench plumbing. The TS forward pass is synchronous,
  <0.1 ms, dependency-free, and identical in browser and bench.
- The parity test is equally strong either way — it pins the deployed
  policy to the trained one, which is the actual risk ONNX was meant to
  manage.

## Consequences

- Nets that outgrow a hand-rolled MLP (convolutions, attention,
  recurrence) reopen this decision; `format: sls-mlp-policy-v1` exists so
  a future runtime can dispatch on it.
- The 1.5 MB JSON gzips to ~600 KB over the wire (static host handles it).
- `export_policy.py` is the single source of the artifact; regenerating it
  regenerates the fixture, so weights and parity test cannot drift apart.
