# Milestone-gate records

Durable, versioned copies of the benchmark runs that **met each milestone's
quantitative outcome gate** (SLS-67). The rest of `eval/results/` is gitignored
(regenerable, ephemeral); these specific records are the evidence behind the
numbers quoted in the README and `eval/reports/v1-controller-comparison.md`, so
they are committed and won't expire with CI's 7-day artifact retention.

Protocol for every record: TS physics core at 250 Hz, the three
`booster-descent-*` wind scenarios, **30 seeded** Monte-Carlo runs per cell with
jittered initial worlds (`jitterInitialWorld`), catch judged by
`evaluateCatchOutcome` against the standard envelope (10 m / 5 m·s⁻¹ vert /
2 m·s⁻¹ horiz / 3° tilt / 5°·s⁻¹).

| File                           | Milestone          | Gate met                        | Commit             | Produced by                 |
| ------------------------------ | ------------------ | ------------------------------- | ------------------ | --------------------------- |
| `m5-mpc-bench-mpc-30seed.json` | M5 (convex MPC)    | 2026-07-05 · **53 / 50 / 50 %** | `3752750` (PR #40) | `pnpm bench:mpc --seeds 30` |
| `m5-mpc-bench-pid-30seed.json` | M5 (PID baseline)  | — (0 %)                         | `3752750`          | same run                    |
| `m5-mpc-bench-success.svg`     | M5                 | plot                            | `3752750`          | `tools/eval/plot.ts`        |
| `m6-rl-bench-rl-30seed.json`   | M6 (neural policy) | 2026-07-09 · **87 / 87 / 90 %** | `13f18d2` (PR #52) | `pnpm bench:rl --seeds 30`  |
| `m6-rl-bench-pid-30seed.json`  | M6 (PID baseline)  | — (0 %)                         | `13f18d2`          | same run                    |
| `m6-rl-bench-success.svg`      | M6                 | plot                            | `13f18d2`          | `tools/eval/rl-bench.ts`    |

Notes:

- The M5 MPC record was produced by the Python guidance service (`services/mpc`)
  and is **not** re-run in CI; it is the recorded gate result. The M6 RL record
  is reproducible from the repo alone (pure-TS policy): `pnpm bench:rl`.
- The three JSON cells in each file correspond to the calm / standard / stormy
  scenarios (M6) or the wind 0 / 1 / 2× sweep (M5).
- These files are also attached to the `v0.5.0` / `v0.6.0` GitHub Releases.
