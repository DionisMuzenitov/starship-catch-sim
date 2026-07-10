# Controller comparison v1 — PID vs MPC vs RL (booster catch)

_Generated 2026-07-09 (SLS-30). Protocol: TS physics core (250 Hz), the three
`booster-descent-_` scenarios from 65 km, 30 seeded runs per cell with
jittered initial worlds (`jitterInitialWorld`), catch per
`evaluateCatchOutcome` against the standard envelope (10 m / 5 m/s vert /
2 m/s horiz / 3° tilt / 5°/s).\*

## Catch success rate (30 seeds/cell)

| controller                               | calm     | standard | stormy   |
| ---------------------------------------- | -------- | -------- | -------- |
| PID (cascaded, M4)                       | 0 %      | 0 %      | 0 %      |
| MPC (convex planner, M5 gate record¹)    | 53 %     | 50 %     | 50 %     |
| **RL — imitation-learned neural policy** | **87 %** | **87 %** | **90 %** |

¹ MPC numbers are the recorded SLS-47 gate results (same 30-seed protocol);
they are not re-run here because the MPC service is a separate Python
process. Re-run with `pnpm mpc:serve` + `pnpm bench:mpc --seeds 30`.

## Median terminal accuracy & fuel (successful RL runs land; PID never does)

| controller | scenario | median final pos err | median fuel used |
| ---------- | -------- | -------------------- | ---------------- |
| RL         | calm     | 5.2 m                | 231.0 t          |
| RL         | standard | 4.6 m                | 230.8 t          |
| RL         | stormy   | 4.7 m                | 231.3 t          |
| PID        | calm     | 3 510 m              | 243.7 t          |
| PID        | standard | 3 884 m              | 247.0 t          |
| PID        | stormy   | 5 492 m              | 245.9 t          |

Raw data (committed, versioned — [gate records](../results/gate-records/MANIFEST.md)):
[`m6-rl-bench-rl-30seed.json`](../results/gate-records/m6-rl-bench-rl-30seed.json)
(+ its PID pair) and the [`m6-rl-bench-success.svg`](../results/gate-records/m6-rl-bench-success.svg)
plot. Regenerate with `pnpm bench:rl`.

## What the RL policy actually is (provenance — read before quoting)

- **Imitation-learned, not RL-trained**: behaviour cloning on ~1 700
  successful demonstrations from a scripted cascade controller (suicide-burn
  ignition law + saturated-P guidance), curated per the SLS-51 findings
  (success-filtered, coast-subsampled). Direct RL (PPO ×3 configurations,
  SAC + demo seeding) failed to produce any catching policy at laptop
  compute; the diagnosis trail is on SLS-51.
- **Architecture**: 17 → 256 → 256 → 4 tanh MLP (578 KB) commanding
  `[thr_centre, thr_inner, lean_x, lean_z]` at 25 Hz over a 250 Hz
  body-frame attitude PD (ADR-015/016) — the same guidance/control layering
  real boosters use.
- **Runtime**: pure-TS synchronous forward pass (`RLController`), weights in
  `apps/web/public/models/booster_policy.json`. TS ↔ Python parity is
  CI-tested to 1e-4 on fixed observations (`rlController.test.ts`).

## Discussion

The 34-40-point margin over MPC comes from two places. First, the teacher
the policy clones already solves the whole-descent energy problem
(ignition timing computed from true mass and altitude back-pressure),
where the MPC formulation plans in a shorter horizon and pays for
replanning latency. Second, the policy inherits the 250 Hz inner attitude
loop, while the M5 MPC flies through a 1 Hz plan cadence.

The stormy result (90 %, statistically indistinguishable from calm at
n=30) deserves a caveat: the policy never trained on the stormy wind
profile. It generalizes because the inner-loop PD absorbs attitude
disturbances and the training distribution included comparable wind
offsets under domain randomization. Treat stormy robustness as promising,
not proven — SLS-54 owns the dedicated campaign.

Known gaps (tracked): mid-scale corridor starts (SLS-52 — a _different_
checkpoint, `clone3_dagger1`, is strong there), RL polish beyond the
teacher's ceiling (SLS-53), Manual/ship rows + 100-seed matrix +
leaderboard JSON (M7).
