# ADR-014: PPO training pipeline — vectorized plant, two-axis curriculum, DR

- **Status:** Accepted
- **Date:** 2026-07-06
- **Tickets:** SLS-29 (M6 training); builds on ADR-013 (numpy port + parity)
- **Relates to:** docs/rl-reward.md (reward design), ADR-010 (MPC bench numbers)

## Context

SLS-29 trains a PPO policy to catch the booster, targeting ≥ 80 % success on
`BoosterDescentStandard` and, for the M6 gate, RL ≥ MPC catch rate (53/50/50 %
on the TS bench). Constraints discovered at plan time:

1. **Throughput.** The SLS-28 numpy port ran at **44 control-steps/s** per env
   on the build machine (base M3, 4 P-cores). Profiling: ~85 % of `sim_step`
   was the 33-engine Python loop (scalar quaternion ops + tiny-array numpy
   churn). At that speed 10M PPO steps ≈ 9+ h — over the ticket's < 4 h budget.
2. **Signal dilution.** A full descent is ~6 000 control steps (240 s sim),
   mostly unpowered coast. SLS-47's central finding applies to RL too: the
   terminal catch is the hard part; episodes dominated by coast starve the
   catch of gradient signal.
3. **No GPU.** Apple-Silicon laptop; SB3 MLP policies train fastest on CPU
   (MPS overhead exceeds the win for 256×256 nets).

## Decisions

**1. Vectorize the plant across the engine/surface axis** (`physics_np`).
Static per-vehicle arrays are packed once per `Vehicle` instance (cached via
`object.__setattr__` on the frozen dataclass); the engine update, gimbal
rotation, force/torque and mass-flow evaluate as batched numpy ops.
Result: **44 → 422 control-steps/s (9.6×)**; 10M steps ≈ 4 h wall on 8
workers including PPO update overhead. Parity: batched reductions reorder
float sums (~1e-16 rel) — far inside the ADR-013 gate (rtol 1e-6); the
equivalence suite is the contract and stays green. The booster fixture is no
longer bit-exact, by design.

**2. Two-axis curriculum, corridor-first** (`rl.curriculum`), promoted by
deterministic eval success ≥ 0.8 per stage:

- *Start-state axis* (added beyond the ticket): the first plan used ballistic
  bands (start part-way down the cached engines-off descent) — and the
  smoke-run diagnostic killed it: the nominal ballistic **deliberately lands
  ~800 m past the tower** (SLS-49 safety offset), so even a scripted vertical
  suicide-burn terminates ~790 m from the catch point. Every ballistic start
  embeds a hard powered divert — unlearnable as a first rung. The curriculum
  therefore opens with **corridor starts** (`rl.ballistic.corridor_start`:
  above the catch point, small lateral offset, descending, upright — the
  state class MPC's dock phase reaches, where a crude hand cascade already
  near-misses), then widens the corridor, then ballistic bands (divert +
  fin steering), then the full 65 km IC.
- *Wind axis* (the ticket's): Calm → Standard → Stormy, real layered + OU
  turbulence fields (`rl.wind_np`, distribution-mirror of wind.ts per
  ADR-013 — the Dryden PRNG is not bit-parity).

The ticket's 80 %-on-Standard target is exactly the promotion bar of the
`full-standard` stage.

**2b. Reward amendments found by smoke-diagnostics** (full detail in
docs/rl-reward.md): (i) **graded terminal** — flat −100 on every failure gave
PPO no gradient through the terminal event (150k steps, ep_rew flat at −91);
failures now earn back up to 60 by terminal closeness-to-catchable, ordering
preserved; (ii) **shaping scale** — Φ weights ×5 so telescoped shaping is
O(10–50) per episode instead of ~±3 against a ±100 terminal (policy-invariant
for any Φ); (iii) **escape terminal** — leaving the flight envelope ends the
episode (graded), closing the "fly away on mid throttle" exploration mode
(the action midpoint maps to 50 % throttle ⇒ TWR ≈ 2.6); (iv) **γ = 0.999,
not 0.99** — at 25 Hz control γ=0.99 is a ~4 s horizon, and a 1.2M-step run
exploited it by *procrastinating*: fly away until the escape bound at step
~480, where the −100 terminal is discounted to nothing (γ^480 ≈ 0.008).
Checkpoint rollouts showed 8/8 episodes ending `escaped`, ascending,
tumbling. γ=0.999 (~40 s horizon) makes both the delayed penalty and the
prospective catch bonus visible; a near-trivial `hover-calm` first rung was
added at the same time so the value function receives real +100 catch
signals early (first-rung-nearly-solved principle).

**3. Domain randomization as a wrapper** (`rl.dr`): per-episode perturbed
frozen `Vehicle` copies (thrust ±5 %, Isp ±2 %, τ ±20 %, dry mass ±5 % with
inertia scaled), wind layer offsets ±5 m/s, turbulence ×[0.5, 2], Gaussian
obs noise, IC ±200 m / ±20 m/s. Eval always runs the nominal plant (DR off,
real wind) so success numbers measure transfer, not memorization.

**4. Fixed observation normalization** (env `OBS_SCALE`), not VecNormalize
running stats: the same 17 constants ship with the ONNX export (SLS-30) —
no runtime statistics to freeze or drift. VecNormalize is used for *reward*
normalization only (train-time only, no inference impact).

**5. Action space (booster training): 8-dim masked** — centre + inner
throttles, gimbal pitch/yaw, 4 fins. Outer/ship groups are physically unused
in a catch (landing burn = 3 centre + 10 inner); masking them shrinks the
exploration space. The SLS-28 10-dim contract stays the env default.

**6. Stack:** SB3 2.9 PPO (MlpPolicy 256×256), SubprocVecEnv(8), TensorBoard,
YAML-versioned configs, checkpoints (periodic + best + `latest.zip`) with
VecNormalize + curriculum state for resume, and a `manifest.json` (obs scale,
action layout, frame_skip, γ) for the SLS-30 exporter. Torch/SB3 live in a
separate uv dependency group (`train`) — CI stays numpy-only and runs the
DR/wind/curriculum unit tests, not training.

## Red-team vs the 80 % gate

The plant is controllable through this envelope (MPC+PID closes catches from
full descent at 50-53 %; the RL policy actuates the same plant at 25 Hz with
richer per-step authority). Potential-based shaping (policy-invariant) plus
the catch-first curriculum concentrates learning exactly where SLS-47 showed
the difficulty lives. The honest risk is PPO sample-efficiency on a 6-DOF
sparse-goal task within a laptop compute budget: if a given run plateaus
short of 80 %, that is a tuning outcome — the pipeline (curriculum, DR, eval,
resume) is the deliverable that makes iteration cheap, and results are
reported as measured, never extrapolated.

## Consequences

- Training runs locally in ~4 h for 10M steps; resumable; reproducible
  (seeded envs, seeded DR, versioned config).
- The numpy plant now has two evaluation profiles (scalar-equivalent math,
  batched execution) with the equivalence suite as the single contract.
- New risk: curriculum promotion thresholds are hyperparameters; a stage bar
  set too high can stall progression (mitigation: TB `eval/stage_index`
  makes stalls visible; bars are config, not code).

## Alternatives considered

- **Numba/JIT or a C extension** for the plant — more speedup, but a new
  toolchain + drift surface against the TS source; batched numpy got 9.6×
  with zero new dependencies. Revisit only if training becomes the bottleneck.
- **VecNormalize obs stats** — better-conditioned in theory, but freezes
  training-time statistics into the export path (SLS-30); fixed scales are
  deterministic and parity-friendly.
- **cleanrl** — single-file transparency, but SB3's callbacks/vec-env/resume
  machinery is exactly what the curriculum needs; ticket names SB3 primary.
- **Full-descent-only training (no altitude curriculum)** — rejected: 6 000-
  step episodes at 44→422 cps waste most compute on coast, and the sparse
  catch signal rarely fires early in training.
