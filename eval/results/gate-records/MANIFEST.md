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
| `v2-acceptance-rl.json`        | **v2 acceptance (RL)**  | 2026-08-08 · **96 / 59 / 36 %** | `83f62f7` (SLS-93/97) | `pnpm campaign:v2`      |
| `v2-acceptance-mpc.json`       | **v2 acceptance (MPC)** | 2026-08-08 · **49 / 37 / 39 %** | `83f62f7`          | `pnpm campaign:v2`          |
| `v2-acceptance-pid.json`       | v2 acceptance (PID)     | — (0 %)                         | `83f62f7`          | `pnpm campaign:v2`          |
| `v2-acceptance-sweep-*.json`   | v2 full width sweep     | catch-rate-vs-width curve       | `83f62f7`          | `pnpm campaign:v2`          |

**The `v2-acceptance-*` records are the current canonical headline** (the README
Results table + the progression chart read them via `tools/eval/generations.ts`).
They come from the **v2 methodology (SLS-110/97)**: held-out acceptance seeds
(reserved band `0x5AFE_0000`, disjoint from training), a physically-grounded
entry-corridor dispersion (position/velocity/FPA/attitude/rate/propellant) with a
**fresh per-run wind realization**, **300** seeds/cell (PID/RL) and **100** (MPC),
at the **±20 m entry-corridor reference width**. The full catch-rate-vs-width
curve is the `-sweep-` files + the [comparison report](../../reports/v1-controller-comparison.md).
The `m5-*` / `m6-*` records are **retained as the historical milestone-gate
evidence** (attached to `v0.5.0` / `v0.6.0`), no longer the headline.

Notes:

- The M5 MPC record was produced by the Python guidance service (`services/mpc`)
  and is **not** re-run in CI; it is the recorded gate result. The M6 RL record
  is reproducible from the repo alone (pure-TS policy): `pnpm bench:rl`.
- The three JSON cells in each file correspond to the calm / standard / stormy
  scenarios (M6) or the wind 0 / 1 / 2× sweep (M5).
- These files are also attached to the `v0.5.0` / `v0.6.0` GitHub Releases.

> **⚠ M5 MPC record — historical only; do not quote "53 / 50 / 50 %" as MPC's
> catch rate (SLS-93, resolved).** The v2 acceptance re-bench (above) benched MPC
> on genuine per-run wind at 100 seeds — **49 / 37 / 39 %** at the ±20 m corridor
> — superseding this record as the headline. The three original caveats it fixes:
>
> 1. **The three cells are not calm / standard / stormy.** They are the
>    `booster-descent-calm` scenario at windScale 0 / 1 / 2× — but calm's base
>    wind is zero, so scaling it is a **no-op**: the ×1 and ×2 cells are
>    byte-identical and the "53 vs 50" gap is a single seed flipping on solver
>    nondeterminism. The MPC has **never** been benched on the genuine
>    `-standard` / `-stormy` wind scenarios the M6 (RL) columns use, so pitting
>    the two rows column-for-column compares different environments.
> 2. **Measured with sim time paused during each solve.** `mpc-bench.ts` awaits
>    the in-flight HTTP solve with the clock stopped, so the vehicle sees zero
>    guidance latency. Interactive play at ×1 approximates this; fast-forward
>    does not (that gap is what SLS-94 clamps).
> 3. **Predates SLS-78 zero-fuel gating.** A few of the record's caught runs
>    burned the tank to exactly 0 kg under the old physics where empty tanks
>    still thrust; the record has not been re-run since.
>
> A real-wind, dual-clock, higher-seed re-bench (100 seeds, `-standard` /
> `-stormy`) is the SLS-93 campaign; this record and the README/report columns
> will be corrected when it lands.
