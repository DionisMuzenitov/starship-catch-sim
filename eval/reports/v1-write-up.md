# Catching a Starship in your browser: a benchmark of human, PID, convex MPC, and RL controllers on a 6-DOF tower-catch simulator

**▶ Play it: <https://dionismuzenitov.github.io/starship-catch-sim/>** — the whole
simulator, three of the four controllers, and the Monte-Carlo evaluator run
entirely in your browser. Fly it by hand, or watch PID, convex MPC, and an
imitation-learned neural policy try to land the Super Heavy booster in the
tower's chopstick arms.

_Draft write-up (SLS-33). Every quantitative claim here is sourced from the
committed benchmark report [`eval/reports/v1-controller-comparison.md`](v1-controller-comparison.md),
which in turn reads the versioned gate records under
[`eval/results/gate-records/`](../results/gate-records/MANIFEST.md). If a number
here disagrees with that report, the report wins — and a CI check
([`pnpm docs:check`](../../tools/docs-check.ts)) fails the build when prose and
records drift apart._

---

## 1. Introduction

In October 2024, SpaceX did something that looked like a special effect: it
flew a 71-metre rocket booster back to its launch pad and caught it in mid-air
with two arms on the tower. There are no landing legs. The booster hovers itself
into a ~metre-scale slot between the arms — the "chopsticks" of a tower SpaceX
calls **Mechazilla** — and the arms close under its grid fins. Catching at the
pad keeps that landing mass off the vehicle and is the bet that makes rapid
reuse possible.

This project asks a narrower, reproducible question underneath that spectacle:
**as a guidance-and-control problem, how hard is the catch, and how do standard
controller families compare on it?** To answer it without SpaceX-internal data,
we built a from-scratch **6-DOF flight simulator** of the booster's return and
descent, wired four controllers into a single physics plant — a human on the
keyboard, a cascaded **PID**, a convex-optimisation **MPC** planner, and an
**imitation-learned neural policy** — and scored them the same way: Monte-Carlo
catch rate over seeded dispersions, on a held-out benchmark.

The headline is deliberately unglamorous and, we think, the interesting part:
**no single controller wins.** The learned policy dominates the calm,
near-nominal corner (96 % catch rate at a ±20 m entry corridor in calm air) but
falls off steeply as wind and entry dispersion grow; the convex-MPC re-planner
is markedly more weather-robust and overtakes it once conditions get messy; and
the naïve PID baseline catches **0 %** — not because it is a strawman, but
because a pure tracking loop never solves the actual problem, which is *when to
light the engines*.

The value of the project is not "this is exactly Starship." It plainly is not
(see §8). The value is a **reproducible controls test-bench**: one physics core,
one catch criterion, four controllers, and a benchmark harness that is honest
about its own uncertainty.

## 2. Related work

**Landing-and-catch sims and games.** The closest genre comparable is
alxndrTL's *Landing-Starships*, which leads with a landing GIF and a headline
metric; there are also community Starbase simulators (e.g. ashtorak's Starbase
Sim) and lunar-descent toys in the lineage of *ApolloLM* / the classic Lunar
Lander. These are excellent for feel; our emphasis is different — a
*head-to-head controller benchmark* on a shared, versioned physics core, with
committed numbers rather than a highlight reel.

**Convex guidance for powered descent.** The MPC controller here is a direct
descendant of the powered-descent-guidance (PDG) literature. The load-bearing
idea is **lossless convexification** — Açıkmeşe & Blackmore (2011) show that the
non-convex minimum-fuel landing problem, with its lower thrust bound, can be
relaxed to a convex second-order-cone program (SOCP) whose optimum coincides
with the original. NASA's **G-FOLD** work took this to hardware. For the
aerodynamic, non-linear regime, **successive convexification (SCvx)** of Mao,
Szmuk & Açıkmeşe iterates convex sub-problems to a feasible trajectory. Our
service implements a linear lossless-convexification SOCP with an optional SCvx
mode for drag.

**Learning-based control.** The neural policy sits in the
imitation-learning / RL tradition — gymnasium environments and Stable-Baselines3
(SB3) for the training scaffolding, and potential-based reward shaping (Ng,
Harada & Russell, 1999) as the lens through which we diagnosed why direct RL
struggled here (a sparse terminal reward with no shaping gradient; see §4.4).
The shipped policy is ultimately *behaviour-cloned* from a scripted teacher, a
choice we defend rather than hide.

## 3. Simulator design

**Stack.** A pnpm monorepo: Vite + React + React-Three-Fiber for the browser
front-end, a TypeScript physics core, a Python convex-MPC service (FastAPI +
CVXPY/Clarabel), and a Python RL/imitation-learning pipeline with a **numpy port
of the physics** so the training environment and the browser fly the *same*
dynamics. TypeScript↔Python parity is CI-tested to 1e-4 on every push — the
single most load-bearing invariant in the project, because a training/eval
physics mismatch would silently invalidate every number.

**Dynamics.** Full **6-DOF rigid-body** integration at 250 Hz: translational and
rotational state, quaternion attitude, and **variable mass, centre-of-mass, and
inertia** as propellant burns (with a parallel-axis update about the shifting
CoM). Aerodynamics are **Mach-dependent table aero** — drag and grid-fin/flap
authority interpolated over a coefficient table across the sub/transonic/
supersonic regimes, not a constant $C_d$. Wind is a layered profile plus Dryden
turbulence; the benchmark draws a **fresh wind realization per run**.

**Vehicle.** The Super Heavy booster: 33 Raptor engines (only the inner 13
gimbal — a detail that matters for control authority), grid fins for aerodynamic
steering, and the flight-proven **V1/V2 catch interface** (load pins under the
grid fins). The tower catch geometry and an explicit **capture envelope** close
the loop.

**Determinism.** The integrator is fixed-step and deterministic: the same seed
produces the same trajectory, in the browser and in the numpy port alike. This
is what makes the benchmark reproducible in the strong sense — anyone can
re-run `pnpm campaign:v2` and get the committed numbers — and it is what the
1e-4 parity test protects.

**The catch criterion.** A run is a catch iff, at the terminal frame, the
booster is within the standard envelope: **10 m** position, **5 m·s⁻¹** vertical
speed, **2 m·s⁻¹** horizontal speed, **3°** tilt, **5°·s⁻¹** body rate — all
simultaneously. This is a tight, unforgiving gate; "close" is a crash.

## 4. Controllers

All four implement one interface — `step(world, dt) → ControlInput` — and drop
into the identical simulation loop, so switching them changes nothing but the
policy.

### 4.1 Manual

Keyboard flight (throttle groups, gimbal, fins). Present for feel and as a
sanity check on the plant, not benchmarked here.

### 4.2 Cascaded PID

A classical cascade: outer position/velocity loops feeding an inner
attitude-rate loop, driving gimbal and throttle. It is a competent *tracking*
law and a deliberately naïve *baseline* — it has no model of the descent energy
and no notion of ignition timing.

### 4.3 Convex MPC

A receding-horizon planner. The browser client hands the current state to a
Python service that solves a lossless-convexification SOCP (with an optional
SCvx drag mode), returns an ignition time and thrust profile, and re-plans at
~1 Hz; a soft body-frame PD tracker flies the plan between re-plans.

The trick that makes this tractable in real time is worth spelling out. The
honest minimum-fuel landing problem is **non-convex**: the engine has a *lower*
thrust bound (a Raptor cannot throttle to zero and relight instantly), so the
feasible thrust set is an annulus, not a ball. Açıkmeşe & Blackmore's lossless
convexification introduces a slack variable for thrust magnitude and proves that
the convex relaxation's optimum coincides with the original non-convex
problem — so a solver that only handles convex cones still returns the true
minimum-fuel trajectory. Drag makes the dynamics non-linear on top of that,
which is where successive convexification (SCvx) comes in: iterate a sequence of
convex sub-problems, each linearised about the last solution, until the
trajectory stops moving. The upshot is a planner that solves in **milliseconds**
per re-plan and can therefore keep up with a 1 Hz cadence.

This is the "principled" controller: it explicitly reasons about *when* and *how
hard* to burn, and — unlike the learned policy — it re-derives that reasoning
from wherever it actually is, every second. Its known limitation in v1 is that
the **plan is wind-blind** — it propagates in still air and leans on the soft
tracker to reject gusts, which is exactly why it does well on finite dispersions
but is not *more* robust than it could be (tracked for a wind-aware upgrade).

### 4.4 Neural policy (imitation-learned)

The headline learned controller — and it is **imitation-learned, not
RL-trained.** Direct RL (PPO in three configurations, plus SAC with demo
seeding) never produced a catching policy at laptop compute: the terminal
success reward is sparse, there is no shaping gradient through the
ignition event, and episodes end long before credit propagates. Rather than
throw more compute at it, we cloned a **scripted cascade teacher** — a
suicide-burn ignition law plus saturated-P guidance — over ~1 700 curated
successful demonstrations (success-filtered, coast-subsampled).

Crucially, **the teacher is privileged**: it plans from the *true* world state
(exact mass, altitude, velocity). The shipped student sees only the **noisy
observation vector**. So the teacher is an upper bound on the control *law*, not
a deployable controller, and the interesting artefact is the observation-only
student distilled from it. The policy is a compact **17 → 256 → 256 → 4 tanh
MLP** (578 KB) commanding `[thr_centre, thr_inner, lean_x, lean_z]` at 25 Hz
over a 250 Hz body-frame attitude-PD inner loop — the same two-rate
guidance/control layering real boosters use. It runs a **dependency-free
TypeScript forward pass** in the browser (no ONNX, no WASM), and its TS↔Python
parity is CI-tested to 1e-4.

## 5. Experiments

The benchmark that matters is the **v2 acceptance harness** — designed to be
un-gameable by construction:

- **Domain-randomized dispersion.** Each run perturbs the full entry state —
  position, velocity, flight-path angle, attitude, body rate, and propellant —
  around the nominal corridor, at a controllable 1σ width.
- **Fresh per-run wind.** Every run instantiates a new wind field (an earlier
  bench froze a single gust sequence across all runs; see §7).
- **Held-out seeds.** Evaluation seeds are drawn from a reserved band
  (`0x5AFE_0000`) that is *disjoint from any training/development seed*, so the
  learned policy cannot have memorized them.
- **Scale.** 300 seeds/cell for PID and RL, 100 for MPC (its Python solve is the
  bottleneck), across three wind scenarios (calm / standard / stormy) and five
  corridor widths (±20 → ±400 m).
- **Uncertainty reported.** Every cell carries a **Wilson 95 % confidence
  interval**, so overlapping intervals are read as ties, not decisive wins.

Reproduce the whole thing with `pnpm campaign:v2`; the records land in
`eval/results/gate-records/v2-acceptance-*.json`.

## 6. Results

### 6.1 Headline — ±20 m entry-corridor reference width

| controller  | calm     | standard | stormy   |
| ----------- | -------- | -------- | -------- |
| PID (M4)    | 0 %      | 0 %      | 0 %      |
| MPC (M5)    | 49 %     | 37 %     | 39 %     |
| **RL (M6)** | **96 %** | **59 %** | **36 %** |

### 6.2 The crossover — full catch-rate-vs-dispersion-width curve

The single number hides the story. Widen the entry corridor and the ranking
inverts (catch rate %, [95 % CI]):

_RL (n = 300):_

| σ (m) | calm       | standard   | stormy    |
| ----- | ---------- | ---------- | --------- |
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

Read where the intervals do **not** overlap: **RL owns the calm, near-nominal
corner** (±20 m calm, 96 % vs 49 %); **MPC owns the windy middle** (e.g. ±50 m
stormy, 48 % vs 21 %; ±100 m standard, 49 % vs 18 %) and degrades far more
gracefully as the corridor widens. Both collapse toward single digits by
±400 m — a scale at which the vehicle simply cannot make the envelope.

### 6.3 Why PID is 0 % (and why that is a result)

PID is 0 % at *every* width. That is the point, not a strawman: with no energy
or ignition management, a cascaded PID holds attitude but never decides when to
burn, so its **median terminal miss is 3.5–5.5 km** — four orders of magnitude
outside the 10 m envelope. The catch is fundamentally an *ignition-planning*
problem, which is exactly the axis MPC plans on and the teacher the neural
policy cloned already solved. Median terminal accuracy makes the gap concrete:
successful RL runs land ~4.6–5.2 m from target; PID medians are 3 510 / 3 884 /
5 492 m.

### 6.4 A quirk worth flagging

MPC catches *less* at ±20 m than at ±50 m in all three scenarios — a
near-nominal start is, counter-intuitively, harder for it than a small finite
error. The per-cell intervals overlap, but the dip is consistent across
scenarios, so it looks systematic rather than noise; it is tracked for
investigation rather than swept under the rug.

## 7. Discussion

**Why the learned policy dominates the calm corner.** Two reasons. First, the
teacher it clones already solves the whole-descent energy problem — ignition
timing computed from true mass and altitude back-pressure — whereas the v1 MPC
plans over a shorter horizon and pays a replanning-latency tax. Second, the
policy inherits the 250 Hz inner attitude loop, while the M5 MPC flies through a
1 Hz plan cadence. Where the entry is clean, the distilled whole-trajectory law
plus a fast inner loop is hard to beat.

**Why MPC wins the weather.** The learned policy's calm dominance is exactly its
brittleness: it was distilled from near-nominal demonstrations, so out of
distribution — big dispersions, strong gusts — it has nothing to fall back on
and degrades steeply. MPC re-plans from wherever it actually is every second, so
a large finite error is just a new initial condition; it holds up across the
windy middle of the sweep. This is the classic **specialist-vs-generalist**
trade-off, and it is the single most important thing the benchmark surfaces.

**Honesty about the frozen-wind trap.** An earlier fixed-wind bench reported
87 / 87 / 90 % across calm / standard / stormy. <!-- docs-check:ignore historical pre-v2 overfitting number, superseded by the v2 curve above -->
That was **overfitting to a single frozen gust sequence** reused across every run; when
the benchmark switched to a fresh per-run wind realization and held-out seeds,
the windy columns fell to 59 / 36 %. The gap between "87–90 %" and the honest
curve *is the reason* a domain-randomized, held-out benchmark exists. We report
the lower, honest number.

## 8. Limitations

Stated plainly, because the strength of the project is reproducibility, not
fidelity:

- **Not Starship.** Aerodynamics are table-interpolated, not CFD; there is no
  offshore-divert / abort-to-water profile; no propellant slosh; no
  structural or thermal dynamics. The vehicle models the flight-proven **V1/V2**
  catch interface, one generation behind the **V3** now flying (three larger
  grid fins that *are* the catch interface; a 13→5→3 landing-burn profile).
- **The ship catch is speculative.** No Starship *upper-stage* catch has ever
  been flown; the sim models the *booster* catch and its ship envelope is
  invented by analogy.
- **MPC is wind-blind in v1.** The plan propagates in still air; a wind-aware
  formulation is expected to move the MPC curve.
- **The teacher's own catch rate under this dispersion is not yet measured
  comparably** (the acceptance harness is TypeScript-side; the teacher is a
  Python script), so we quote it qualitatively as a privileged upper bound, not
  a number.
- **Stormy generalization is promising, not proven** — the policy never trained
  on the stormy wind profile; it generalizes because the inner-loop PD absorbs
  attitude disturbances and training used comparable wind offsets.

## 9. Future work

- **Wind-aware MPC** — make the plan account for wind (or stiffen terminal
  tracking) and re-bench; the crossover point should shift.
- **RL polish beyond the teacher's ceiling** — BC-regularized PPO on top of the
  imitation clone, to exceed the demonstrations rather than match them.
- **Mid-corridor and stormy campaigns** — a different checkpoint is already
  stronger on mid-scale starts; a dedicated stormy campaign would turn
  "promising" into "measured."
- **Engine-out robustness** — detect an engine failure during the landing burn
  and adapt, an axis real boosters must handle.
- **V3 realism** — the three-grid-fin catch interface and the 13→5→3 burn.
- **Ship catch** — once Flight 14 flies and its envelope is public.

## 10. Reproducibility

- **Run the benchmark:** `pnpm campaign:v2` (held-out acceptance sweep). MPC
  additionally needs the local service: `pnpm mpc:serve` then `pnpm bench:mpc`.
- **All numbers are pinned:** every headline traces to a committed gate record
  under `eval/results/gate-records/`, and `pnpm docs:check` fails CI if prose
  and records disagree.
- **The policy is inspectable:** 578 KB of JSON weights in
  `apps/web/public/models/booster_policy.json`, run by a ~30-line pure-TS
  forward pass. TS↔Python parity is CI-tested.
- **The decision trail is public:** two dozen ADRs in `docs/adr/`, including the
  documented failures (direct RL never converged; the frozen-wind overfitting).

## 11. What changes if you have full SpaceX-internal data

Almost everything about *fidelity*, and very little about the *conclusion*.

With real aerodynamic coefficients (CFD- and flight-derived), true Raptor
throttle/thrust/gimbal dynamics and their failure modes, the actual V3 vehicle
and catch interface, real sensor and actuator noise models, and the flight-data
distribution of entry states and winds, the *absolute* catch rates here would
move — probably down in the tails, as unmodelled effects bite. What is unlikely
to change is the **shape of the comparison**: a controller distilled from
near-nominal expert behaviour will beat a re-planner where the entry is clean
and lose to it where reality is messy, because that trade-off is a property of
*specialist vs generalist*, not of our particular drag table. If anything,
richer disturbances would *widen* MPC's robustness advantage.

So the honest pitch is not "we simulated Starship." It is: **on a reproducible,
un-gameable 6-DOF catch benchmark, here is how four standard controller families
actually compare — with the receipts.** The simulator is a lens, and the lens is
open source.

---

_Working draft. Numbers current as of the committed v2 acceptance gate records;
regenerate with `pnpm campaign:v2`. Corrections welcome as GitHub issues —
factual problems especially._
