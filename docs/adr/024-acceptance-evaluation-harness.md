# ADR-024: Domain-randomized acceptance-evaluation harness

- **Status:** Proposed
- **Date:** 2026-07-27
- **Tickets:** SLS-110 (methodology), SLS-97 (statistical hardening), SLS-105 (engine-out axis), SLS-66 (existing RL CI floor)

## Context

We benchmark controllers (PID / MPC / RL) to claim they can catch the booster. The v1 benchmark was overfit: every Monte-Carlo run reused one frozen wind sequence (Dryden seed 42) and perturbed only ±20 m of position, so 100 "runs" were near-clones. It produced a flattering headline (RL 87/87/90 %) that collapses the instant the policy meets a *fresh* disturbance — the exact criticism a reviewer would level first.

SLS-110 replaced that with a domain-randomized dispersion (`packages/controllers/src/eval/dispersion.ts`): a grounded entry-corridor spread over position / velocity / flight-path angle / attitude / rates / propellant, plus a fresh per-run wind realization. The first 30-seed sweep already told a truer, better story — a controller *crossover* (RL wins the narrow calm corner; MPC is the wind-robust generalist). We need to lock how this is used so it stays trustworthy as controllers change, rather than becoming a number people tune against.

## Decision

Treat the domain-randomized dispersion sweep as the project's **standing acceptance benchmark** — the "test set" in the ML train/test sense — governed by four rules:

1. **Held-out and sacred.** The acceptance seed streams + envelope are frozen and only ever *measured*. Controller tuning/training uses a *separate* dev seed stream. Optimizing against the acceptance seeds is forbidden — it re-overfits and voids the measurement. Concretely: the acceptance benchmark draws seeds from a reserved high band (`ACCEPTANCE_SEED_BASE = 0x5AFE_0000`, ~1.53e9), and training/dev/CI seeds stay below it. Because splitmix32 decorrelates distant seeds, a policy trained on seeds below the base cannot have seen the exact realizations it is graded on — held-out *by construction*. (The Python trainer is already a separate PRNG family — gym/numpy PCG64 — so the guarantee holds today and stays structural for any future TS-side training.)
2. **Two tiers, matched to cost.** A fast per-PR CI gate (PID + RL, no service, ~30 seeds, minutes — extends SLS-66) guards against regression on every change; a full acceptance run (all three controllers incl. MPC, 300/100 seeds, Wilson 95 % CIs — SLS-97) is the **weekly quality measurement**, run overnight (~2 h) and on-demand after a deliberate controller change, committing its gate-records. It is deliberately *not* nightly — the full grid is a periodic certification, not a per-commit gate.
3. **Report, don't chase.** Success is a defined acceptance envelope with confidence intervals, not "100 % on everything". Pass/fail is a CI-lower-bound threshold against the committed baseline.
4. **Continuous metrics beside the binary.** Alongside catch rate we record median / 95th-pct terminal position + velocity error and fuel, so improvement is visible even when the binary rate is flat.

The randomized envelope is grounded in real return dispersion (see the KB); its definition is versioned (v2 today). Passing the harness certifies a controller as *robust in-sim* — a candidate for further study, **not** flight-ready (unmodeled: actuator lag, sensor noise, latency, structural flex, full transonic aero).

## Consequences

- **Positive:** claims become defensible ("survives a domain-randomized acceptance benchmark with CIs") — the accepted V&V / sim-to-real practice, not a vanity number; regressions are caught automatically; the crossover and failure modes are surfaced honestly, pre-empting the reception risk (R14).
- **Negative:** the full run costs hours (mitigated by the two-tier split); a frozen envelope can drift from reality and must be re-grounded deliberately; honest numbers are lower than the old headline.
- **Neutral / follow-up:** **engine-out (SLS-105)** is a documented *future axis*, not part of the day-one gate — gated on confirming the physics can disable engines mid-descent and on deciding fault-aware vs fault-tolerant framing. Extends training-time DR (ADR-014) and dispersion robustness (ADR-010) into an acceptance-time gate; parity discipline (ADR-013) unaffected — the harness lives in the eval layer.

## Alternatives considered

- **Keep v1 (single frozen seed).** Rejected — it measures overfitting, not capability, and dies under the first adversarial probe.
- **One heavy full run gating every commit.** Rejected — hours per commit is unworkable; the fast/full tier split gives fast feedback without losing statistical rigor.
- **Catch-rate only, no CIs / no continuous metrics.** Rejected — a binary rate at n=30 has ±~17 pt noise, hiding real regressions and real gains; CIs + error/fuel metrics give a usable signal.
