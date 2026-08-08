# Controller comparison — PID vs MPC vs RL (booster catch)

The **current headline** is the v2 acceptance benchmark below; the earlier
fixed-wind M6 bench is retained beneath it as historical context.

## v2 acceptance benchmark — held-out, domain-randomized (current)

_Methodology (SLS-97 / SLS-110 / [ADR-024](../../docs/adr/024-acceptance-evaluation-harness.md)):
TS physics core (250 Hz); a physically-grounded entry-corridor dispersion
(position / velocity / flight-path angle / attitude / body-rate / propellant)
with a **fresh per-run wind realization**; seeds drawn from a held-out band
(`0x5AFE_0000`, disjoint from training). 300 seeds/cell (PID/RL), 100 (MPC).
Catch per `evaluateCatchOutcome` against the standard envelope (10 m / 5 m·s⁻¹
vert / 2 m·s⁻¹ horiz / 3° tilt / 5°·s⁻¹). Wilson 95 % CIs._

**Headline — ±20 m entry-corridor reference width:**

| controller  | calm     | standard | stormy   |
| ----------- | -------- | -------- | -------- |
| PID (M4)    | 0 %      | 0 %      | 0 %      |
| MPC (M5)    | 49 %     | 37 %     | 39 %     |
| **RL (M6)** | **96 %** | **59 %** | **36 %** |

**No single controller wins — the full curve (catch rate % [95 % CI]) crosses over.**

_RL (n = 300):_

| σ (m) | calm       | standard   | stormy     |
| ----- | ---------- | ---------- | ---------- |
| ±20   | 96 [93–97] | 59 [53–64] | 36 [31–42] |
| ±50   | 58 [52–63] | 36 [31–42] | 21 [17–26] |
| ±100  | 30 [25–35] | 18 [14–22] | 11 [8–15]  |
| ±200  | 17 [13–22] | 10 [7–14]  | 5 [3–8]    |
| ±400  | 6 [4–10]   | 3 [1–5]    | 2 [1–5]    |

_MPC (n = 100):_

| σ (m) | calm       | standard   | stormy     |
| ----- | ---------- | ---------- | ---------- |
| ±20   | 49 [39–59] | 37 [28–47] | 39 [30–49] |
| ±50   | 59 [49–68] | 49 [39–59] | 48 [38–58] |
| ±100  | 38 [29–48] | 49 [39–59] | 42 [33–52] |
| ±200  | 15 [9–23]  | 24 [17–33] | 24 [17–33] |
| ±400  | 12 [7–20]  | 9 [5–16]   | 14 [9–22]  |

PID is 0 % at every width — and that 0 % is the result, not a strawman. A
cascaded PID is a pure _tracking_ law with no energy or ignition management, so
it holds attitude but never solves _when_ to burn; its median terminal miss is
3.5–5.5 km (the [terminal-accuracy table](#median-terminal-accuracy--fuel-successful-rl-runs-land-pid-never-does)
below), never within four orders of magnitude of the 10 m envelope. The booster
catch is fundamentally an ignition-planning problem — which is exactly the axis
MPC plans on and the teacher the neural policy cloned already solved. The
baseline is honest about where a tracking loop tops out.

Reading the crossover: where the intervals do not
overlap the winner is decisive — RL owns the calm, near-nominal corner (±20 m
calm); MPC owns the windy middle (±50 m stormy, ±100 m standard) and holds up
better as the corridor widens. Both fall toward single digits by ±400 m.

**MPC dips at the low end** — lower at ±20 m than at ±50 m in all three
scenarios (a near-nominal start is harder for it than a small finite error). The
per-cell intervals overlap, but the dip is consistent across scenarios, so it
looks systematic rather than noise — tracked as SLS-115.

Reproduce: `pnpm campaign:v2`. Records: `eval/results/gate-records/v2-acceptance-*.json`.

---

## Historical: M6 fixed-wind bench (30 seeds/cell)

_Generated 2026-07-09 (SLS-30). Protocol: TS physics core (250 Hz), the three
`booster-descent-_` scenarios from 65 km, 30 seeded runs per cell with
jittered initial worlds (`jitterInitialWorld`), catch per
`evaluateCatchOutcome` against the standard envelope (10 m / 5 m/s vert /
2 m/s horiz / 3° tilt / 5°/s).\*

### Catch success rate (30 seeds/cell)

| controller                               | calm     | standard | stormy   |
| ---------------------------------------- | -------- | -------- | -------- |
| PID (cascaded, M4)                       | 0 %      | 0 %      | 0 %      |
| MPC (convex planner, M5 gate record¹)    | 53 %¹    | 50 %¹    | 50 %¹    |
| **RL — imitation-learned neural policy** | **87 %** | **87 %** | **90 %** |

¹ **The MPC row is not directly comparable to the RL row, and was re-benched on
genuine wind in the v2 acceptance section above (SLS-93, resolved).** Its three
cells are the M5 gate record's `booster-descent-calm`
scenario at windScale 0 / 1 / 2× — but calm has zero base wind, so the sweep is a
near-no-op (the ×1 and ×2 cells are byte-identical; "53 vs 50" is one seed
flipping on solver nondeterminism). They are **not** the calm / standard / stormy
scenarios the RL row uses, so reading the two rows column-for-column compares
different wind environments. The record was also measured with sim time paused
during each solve (zero guidance latency), and predates SLS-78 zero-fuel gating.
See the [gate-record `MANIFEST`](../results/gate-records/MANIFEST.md) for the full
caveat. Re-bench on the real wind scenarios: `pnpm mpc:serve` + `pnpm bench:mpc
--seeds 30` (the SLS-93 campaign runs 100 seeds on `-standard` / `-stormy`, both
clock modes).

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
- **The teacher is _privileged_, and that's the point.** The scripted cascade
  plans from the **true** world state (exact mass, altitude, velocity); the
  shipped student flies from the **noisy observation vector** only. So the
  teacher is an upper bound on the law, not a deployable controller — "a
  privileged teacher distilled into an observation-only student" is the
  intended strength, stated first rather than discovered. The teacher's own
  catch rate under _this_ held-out acceptance dispersion is not yet measured
  comparably (the harness is TS-side; the teacher is the Python `cascade.py`) —
  tracked as a follow-up so the row, when it lands, is **measured, not
  estimated**.
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
