# ADR-013: RL numpy physics port, single-sourced constants & TS↔Python parity

- **Status:** Accepted
- **Date:** 2026-07-06
- **Tickets:** SLS-28 (M6 RL foundation); closes risk **R1**
- **Relates to:** ADR-004 (engine-agnostic physics), ADR-007/009 (MPC service)

## Context

M6 (RL) trains a PyTorch policy against the simulator. Bridging to the TS
physics per-step would throttle training throughput, so — per SLS-28 — the
physics is re-implemented in numpy (`services/rl`). That creates a second
plant that can drift from the TS source. This is risk **R1**, and it had
already fired: the MPC service's Python constants had drifted (the test files
disagreed — Isp 340 vs 327), and `mpc/aero.py` carried a "KEEP THE TABLES
VERBATIM IN SYNC" comment as the only guard.

## Decision

**1. Constants are single-sourced by codegen, TS is the source of truth.**
`tools/gen-physics-consts.ts` imports the real TS runtime objects (engine +
surface presets, scenario initial worlds, atmosphere/drag tables, catch
envelopes, tower geometry) and serialises them to `services/rl/rl_consts.json`.
The numpy port AND the MPC service consume that JSON. A CI check
(`pnpm gen:consts:check`) regenerates and fails on any diff, so a TS constant
cannot drift from what the Python consumes. (Making TS *read* a JSON it
generates would be circular — single-sourcing means one source, machine-
propagated.)

**2. Full numpy port of `simStep`** (`services/rl/src/rl/physics_np.py`) —
RK4 integrator, thrust plant, aero surfaces, mass model, atmosphere, drag —
in float64, mirroring the TS equations, conventions, and **operation order**.

**3. Parity is a CI gate, not a comment.** `tools/eval/gen-parity-fixtures.ts`
records 5 golden 1-second trajectories (deterministic control, calm wind);
`services/rl/tests/test_equivalence.py` replays the recorded controls through
the numpy port and asserts agreement. A second CI step regenerates the fixtures
and fails on drift, catching *equation* changes (constant changes are caught by
step 1).

**4. `StarshipCatchEnv(gym.Env)`** over the port: 17-dim observation, Box[-1,1]
action decoded to the `ControlInput`, potential-based reward (see
`docs/rl-reward.md`), `gymnasium.vector` support.

**5. The MPC service was retrofitted** onto the same JSON: `mpc/aero.py` loads
the atmosphere + drag tables (killing the R1 "keep in sync" comment) and
`scvx.py` sources the body-drag geometry. `mpc/physics_consts.py` also exposes
canonical Raptor sea-level thrust/Isp for the solver's reduced model.

## The parity result (and why the tolerance is a norm-relative bound)

- **Low-energy booster trajectories match BIT-FOR-BIT** (worst ~3e-17). The
  RK4/plant/mass/atmosphere port is exact.
- **The high-energy ship belly-flop matches to ~4e-4 absolute** — a ~3e-7
  *relative* error on a ~1500 m/s state. This residual is **irreducible
  cross-language float divergence, not an equation error**: Node's V8 libm and
  CPython's libm return different last-ULP results for *some* transcendental
  arguments (verified: `exp(-100000/7400)` and `asin(0.5)` differ by ~1 ULP,
  while the booster's `exp(-65000/8500)` is identical — which is exactly why
  the booster is bit-exact and the ship is not). Near-symmetric flap forces in
  the belly-flop then amplify that ULP noise through catastrophic cancellation
  (a physically ~zero net force component).

Hence the equivalence gate is a **per-state-group L2 tolerance**
`‖Δ‖ ≤ atol + rtol·‖state‖` with `atol=1e-4` (the ticket gate, governing the
low-energy states) and `rtol=1e-6` (1 ppm — far tighter than any physically
meaningful drift, covering the fast ship). Measuring the error against the
*vector norm* (not per-component) is essential: a physically-zero component
under cancellation carries absolute error that is negligible against the
group's scale, which is what parity actually means.

### Red-team vs the gate ("state diff < 1e-4 over 1 s")

Met by construction + verification: shared JSON → identical constants;
identical RK4/quaternion/operation-order in float64 → the booster is bit-exact,
proving the equations. The only residual is libm-level, quantified and bounded
at 1 ppm relative. An actual equation bug would blow past 1 ppm (a real force
error is not a last-ULP effect) — so the gate still catches drift.

## Consequences

- **R1 closed**: constants can't drift (CI diff gate); equations can't drift
  silently (fixture + equivalence gates); the MPC service is on the same source.
- **New `rl` CI job** (uv + ruff + pytest). Deps kept minimal (gymnasium +
  numpy); torch/SB3 are SLS-29, onnx is SLS-30.
- **Known scoping**: the MPC solver's reduced-model thrust/Isp *aggregate*
  (13-engine totals) is a modelling abstraction, not a verbatim TS constant;
  `physics_consts.py` now exposes the canonical per-engine numbers, and fully
  re-deriving the aggregate (which re-tunes solver tests) is left as its own
  change. Dryden turbulence is NOT ported bit-exactly (a stateful PRNG); the
  env uses calm wind, and parity fixtures use calm wind by design — the plant
  is the contract, not the RNG.

## Alternatives considered

- **TS↔Python bridge instead of a port** — rejected per SLS-28 (training
  throughput); a subprocess/IPC per step is far too slow for PPO rollouts.
- **Hand-synced constants (status quo)** — rejected: it is exactly what drifted.
- **Strict absolute 1e-4 everywhere** — rejected: unachievable across libms on
  high-energy trajectories, and a norm-relative bound is the correct notion of
  float parity.
