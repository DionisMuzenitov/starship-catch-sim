# ADR-022: Active catch-assist — cooperating tower-side controller

- **Status:** Accepted
- **Date:** 2026-07-20
- **Tickets:** SLS-82 (active catch-assist). Extends **ADR-020** (catch-as-collision); relates ADR-003 (controller interface), ADR-010 (terminal-dock guidance), ADR-013 (numpy↔TS parity), ADR-019 (tower rig).

## Context

The catch has always had **one** controller — the booster-side flight strategy
(PID/MPC/RL) flying the vehicle to a **fixed** target, `CATCH_POINT_WORLD ≈
(8.5, 91, 0)`. The chopstick arms are a static geometric envelope: a booster
that arrives even slightly outside the ±3.5 m (x) / ±5 m (z) capture slot is a
miss, however slow and upright it is.

That is not how the real Mechazilla works. The arms arrive **wide open**, and as
the booster descends between them they **close flush** against the body so the
booster's **catch pins** land on the arms' **catch rails**, with **aligners**
correcting residual lateral error (SpaceX flights 5/7, 2024–25). The arms are
not a fixed point — they actively close on the incoming vehicle, which is what
lets a real catch tolerate residual dispersion.

SLS-82 asks for that as a **second cooperating controller**: booster-side flies
to the target; tower-side moves the arms to intercept a booster that arrives
*near* the target but slightly off, widening the effective envelope.

**Hard constraints (inherited from ADR-020):**

1. The `evaluateCatch` **envelope** (pos ≤10 m, |v_y| ≤5, v_h ≤2, tilt ≤3°, ω
   ≤5°/s) stays the **sole success gate** — we do not loosen a tolerance.
2. The **numpy↔TS parity** (SLS-28/ADR-013) is load-bearing and must not be
   touched.
3. The **M5/M6 headline catch rates** and the **SLS-66 CI floor** must not move.

ADR-020 wrote the target as *fixed*. Reconciling an *active* assist with "must
not change what counts as a successful catch" is the crux this ADR settles.

## Decision

Add a **`TowerController`** — a new, second controller interface
(`step(world, dt) → TowerCommand`), deliberately NOT overloading ADR-003's
`Controller` (which is locked to `→ ControlInput`). It commands the arms'
lateral reach / height / opening. The sim lags the live `TowerState` toward the
command each tick via a pure, rate-limited `stepTowerState`.

The success target **tracks the live arm catch point**, not a module constant:
`evaluateCatchOutcome` derives the envelope's `targetPosition` from
`chopstickCaptureVolume(tower).center` each tick. The reconciliation with
constraint (1) is exact and mechanical:

> `CATCH_POINT_WORLD` is **defined as** `chopstickCaptureVolume(DEFAULT_TOWER_STATE).center`.
> So for a **stationary** tower (zero reach) the live target **equals** the old
> fixed constant — bit for bit. The tolerances are unchanged. Only an
> **actively-reaching** tower moves the target, and that only happens when a
> tower-side controller is attached. **No attached controller ⇒ identical catch.**

Geometry: `TowerState` gains an `armLateral` (x, z) DOF — a horizontal offset of
the whole catch region from the tower centreline (the carriage + arms reaching).
It shifts `chopstickCaptureVolume` and `chopstickCatchPoints`; it does **not**
move `towerStructureAabb` (the tower doesn't slide). Zero in
`DEFAULT_TOWER_STATE`.

Rate limits make "impossible" catches impossible by construction:

- `clampArmReach` caps `|armLateral|` at `MAX_ARM_REACH_M = 6` — the arms can't
  sweep the pad.
- `stepTowerState` first-order-lags each DOF (`TAU ≈ 0.4–0.6 s`), so a booster
  arriving too far off, or too fast for the arms to reach in time, still leaves
  the capture volume before the arms get there.
- The classifier still demands v_h ≤ 2 m/s, so a booster being *swept past* by
  the moving volume is a `near_miss`, never `caught`.

First strategy — **`TrackingTowerController`**: hold the arms in the closed
gripping pose at the fixed catch height, and slide them laterally toward the
booster's incoming horizontal position once it descends into the catch window.
Lateral-only; opening/height choreography is a later increment.

**Parity:** tower state stays a **separate argument** to the catch functions —
never a `World` field, never in `serializeState`, never perturbing `simStep`. The
assist is a *classification-layer* input (which volume), not a force on the
booster. The numpy port does not change. Verified: the parity suite is untouched.

**Headline protection:** the Monte-Carlo harness gains an **opt-in**
`towerControllerFactory`. `pnpm eval:all` does **not** pass one, so the canonical
cells + the SLS-66 floor keep measuring the fixed tower. A separate
`pnpm bench:catch-assist` runs fixed-vs-assisted and reports the delta.

## Red-team vs the acceptance gate

*"Measurably widens the envelope without letting impossible catches through."*

- **Widens:** proven at the classifier level — a booster 9 m off-axis (outside
  the ±5 m fixed slot, inside 6 m reach) is a miss with the fixed tower and a
  catch once the arms reach it (`catch.test.ts`). On the Monte-Carlo suite (RL
  policy, 20 seeds): **calm 90→90, standard 80→80, stormy 15→90, mean +25 pp**.
  Stormy benefits most because that is where the booster arrives slow/upright
  but wind-dispersed laterally — the residual-error regime the arms exist to
  absorb.
- **No impossible catches:** the classifier *cannot* catch beyond reach + half-
  slot (≈11 m) — a 20 m-off booster is rejected even with the arms fully reached
  (`catch.test.ts`), and the rate limits reject too-far/too-fast arrivals
  (`stepTowerState` tests). The fixed bench is byte-identical to `pnpm bench:rl`
  (90/80/15 on the same seeds), so the headline is provably unmoved.

## Consequences

- **Good:** the sim now models the real catch (arms close on the vehicle);
  residual-dispersion robustness becomes a *tower* capability, decoupled from the
  flight controller; the widening is large where it matters (wind).
- **Cost:** a second controller concept + a live tower pose to thread through the
  runner.
- **Deferred to follow-ups (SLS-82 is the design + first increment of a likely
  epic):** (1) wiring the live assist into the **interactive** SimRunner + the
  visual arms (this increment lands the physics, controller, bench, and ADR);
  (2) opening/closing choreography and a yaw/carriage DOF; (3) evaluating the
  assist against MPC/PID and under the wind sweep.

## Alternatives considered

- **Loosen the `evaluateCatch` tolerances** — rejected: violates ADR-020's sole-
  gate rule and would move the headline.
- **Put tower state in `World`** — rejected: breaks the parity contract for no
  benefit; the catch functions already take `TowerState` as an argument.
- **Overload `Controller` to emit tower commands** — rejected: ADR-003's
  `→ ControlInput` contract is locked and booster-specific.
