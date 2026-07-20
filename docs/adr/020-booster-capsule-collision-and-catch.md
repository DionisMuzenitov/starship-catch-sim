# ADR-020: Booster collision capsule + catch-as-collision

- **Status:** Proposed
- **Date:** 2026-07-19
- **Tickets:** SLS-84 (arm segment collider), SLS-82 (active catch-assist), relates SLS-79, SLS-28

## Context

SLS-79 modelled the ground/tower/OLM as AABBs and tested the booster's **centre
point** against them. SLS-84 added a per-arm **segment-chain** collider (a chain
of tight AABBs tracing each chopstick's real mesh — owner-validated at 15
segments in `/sandbox/arm`) so a graze of the visibly-solid arms can fail. But
the collision test is still *point-in-AABB*: the booster is a dimensionless
point. To make it fire on a real graze we inflated the arm boxes by the booster
radius (4.5 m). A code review flagged this as the wrong model — inflating an
axis-aligned box is a crude, orientation-blind proxy that either under-detects
(inflate 0) or risks rejecting valid catches (inflate 4.5).

Two things are actually missing:

1. **The booster has no collision shape.** It is a 71 m × 9 m cylinder that
   rotates through belly-flop/flip attitudes; a point can't represent that.
2. **The catch is not a physical event.** The arms stay wide open the whole run
   (`setOpening(1)`), and "caught" is a phantom capture-volume check. Nothing
   ever closes the arms onto the booster. The `closeOnTarget` API exists but was
   never wired to the live catch.

**Hard constraint:** RL, MPC, and PID are trained/tuned against the
`evaluateCatch` envelope (position ≤10 m, |v_y| ≤5, v_h ≤2, tilt ≤3°, ω ≤5°/s),
and the M6 neural-policy headline result is defined by it. The numpy↔TS physics
parity (SLS-28) is load-bearing. **Whatever we build must not change what counts
as a successful catch, and must not touch the numpy port.**

## Decision

Give the booster a **collision capsule** (its body axis as a segment + radius
4.5 m) that rotates with attitude, and test it **shape-vs-shape** against the
arm segment boxes and structure AABBs — replacing point-in-inflated-AABB. Keep
the **`evaluateCatch` envelope as the sole success gate**; collision is a
physical/interaction layer, not a new gate. Wire the arms to **close and grip**
when a catch registers, so the catch is a visible collision — one thing catching
another.

Per-tick classification (generalises SLS-79's capture-volume-first):

1. **Caught / near-miss** — booster inside the capture volume → run
   `evaluateCatch`. On success, command the arms to `closeOnTarget` (they swing
   in and grip); the closed-arm contact is the *animation* of the caught state.
2. **Structure hit** — else if the booster **capsule** overlaps any arm segment
   box / tower / OLM → `tower_collision`.
3. **Crash / none** — else ground plane / nothing.

Because step 1 is checked before step 2, the booster capsule overlapping the
*closing* arms during a valid catch is classified `caught`, never a graze — so a
real catch is never rejected.

**Geometry:** capsule-vs-AABB = distance from the AABB to the capsule's core
segment ≤ radius (standard segment/AABB closest-distance test). The classifier
stays a pure function in physics (`catch.ts`/a new `collision.ts`), fed the arm
boxes as data via `SiteCollision` (as today), so it is headless-testable.

## Consequences

- **Positive:** honest orientation-aware collision (no inflate hack); the catch
  becomes a visible physical event (arms grip the booster); benches + M6 result
  are bit-identical (success gate unchanged; numpy port untouched); the SLS-84
  arm segment collider + lab + debug viz are reused as-is.
- **Negative:** more geometry code (segment/AABB distance) and per-tick capsule
  tests; the arm-close choreography must be timed so it doesn't visually clip the
  booster before the grip; still an app-render feature (headless benches pass a
  `null` site — no arm collision, as in SLS-79).
- **Neutral / follow-up:** if we ever want arm collision in the RL/eval loop, the
  capsule test + a physics-frame arm model would need to be ported (parity work);
  deferred until there's demand. Pairs naturally with SLS-82 (catch-assist).

## Red-team — can this meet SLS-84's gate ("hit the arms → fail; catches never
regress")?

Yes, by construction. The success gate is unchanged `evaluateCatch`, so no
trajectory that caught before can fail now, and the numpy parity + M6 numbers are
untouched (the collision layer is TS-app-only). Graze-failure fires only when the
envelope is **not** satisfied **and** the capsule overlaps the arms — and the
envelope is checked first, so a valid catch (capsule overlapping the closing
arms) is classified `caught` before the graze check runs. The capsule is exact
geometry rotating with attitude, so a belly-flop or tilted booster is tested with
its true footprint, not an axis-aligned box that grows/shrinks with orientation.
The one thing to validate at bench time: the arm-close *timing* — the arms must
begin closing only once the catch is registered (or within the capture volume),
else a premature close could clip a booster still on approach. This is a
choreography trigger, not a physics gate, so it can't change bench outcomes.

## Alternatives considered

- **Point-in-inflated-AABB (PR #70, closed)** — inflate each arm box by the
  booster radius and test the centre point. Rejected: orientation-blind (an
  axis-aligned inflate mis-covers a tilted 71 m body), and the review showed it
  either under-detects (inflate 0) or threatens valid catches (inflate 4.5).
- **Full rigid-body contact dynamics (impulses/restitution)** — rejected:
  enormous scope, would destabilise the deterministic fixed-step integrator and
  break numpy↔TS parity, and is unnecessary — we need overlap *classification*
  (grip vs graze), not contact resolution.
- **Make the physical grip the success gate** (a catch only counts if the arms
  physically hold the booster) — rejected: redefines "caught", invalidating every
  RL/MPC/PID bench and the M6 neural-policy result, which are all defined by the
  envelope. The envelope stays the gate; collision is the physical/visual layer.

## Amendment (2026-07-20, ADR-022)

**ADR-022 (active catch-assist, SLS-82) extends this ADR.** It makes the
`evaluateCatch` success **target** track the *live* arm catch point instead of
the fixed `CATCH_POINT_WORLD` constant this ADR assumed. This does **not**
violate the sole-gate / no-headline-move constraint above: `CATCH_POINT_WORLD` is
*defined as* `chopstickCaptureVolume(DEFAULT_TOWER_STATE).center`, so a
stationary tower yields the identical target and identical outcomes — only an
*actively-reaching* tower (a tower-side controller attached, opt-in on the
bench) moves it. The tolerances are unchanged and the numpy port is untouched.
See [ADR-022](022-active-catch-assist.md).
