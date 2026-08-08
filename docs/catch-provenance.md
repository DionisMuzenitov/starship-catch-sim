# Catch provenance — what's flight-proven, what's speculative

_Last updated 2026-08 (SLS-99). Grounds which parts of the simulator's catch
model are anchored to real, flown hardware and which are invented by analogy.
Real-world facts here were cross-checked against public reporting on the dates
noted; the internal source is the 2026-07-25 strategic audit (Wave 2, claims
hardening — two corrections adopted)._

## The booster catch is flight-proven; the ship catch is not

The simulator models the **booster** (Super Heavy) catch. That manoeuvre has
actually been flown and closed:

- **No ship (upper-stage) catch has ever been attempted.** The first attempt was
  announced on **2026-07-25** (Musk), for **Flight 14** — which, because a ship
  catch requires the ship to return from orbit, must also be Starship's **first
  orbital flight** (payload: operational V3 Starlink). It follows Flight 13's
  successful ocean splashdown of the ship on 2026-07-24, and is pending
  regulatory approval. Catch geometry, approach corridor, and terminal envelope
  for the ship are therefore **non-public** — the sim's `SHIP_CATCH_ENVELOPE`
  tolerances are **invented**, grounded only by analogy to the booster catch and
  to the demonstrated ship-splashdown sequence (Flight 13: 3-engine flip → 2 →
  1). Revisit after Flight 14 flies.

## V1/V2 catch interface (what the sim models) vs V3 (what flies now)

The sim's catch geometry models the **flight-proven V1/V2 interface**:

- **V1/V2 — pins under the fins.** The booster hangs on load-bearing pins just
  below the forward grid fins; the chopstick arms close under the pins. This is
  the **only generation ever caught** — Flights **5, 7, and 8** (no booster
  catch has been made since ~2025-03, when the V3 water-landing test campaign
  began). Flight 6 was an in-flight **abort to water** (tower-side comms issue);
  a *post-commit* late abort instead targets the ground beside the tower (the
  Flight 5 near-abort), **not** the Gulf — SpaceX's "divert" names the planned
  move *away* to the water, a distinct manoeuvre.
- **V3 — the grid fins _are_ the interface.** Super Heavy V3 (Block 3) dropped
  from **four grid fins to three**, each ~**50 % larger**; there are no separate
  catch pins — the larger fins themselves are the catch interface. The landing
  burn also changes: a **13 → 5 → 3** engine step-down (the inner-13 can start
  any engine for redundancy), versus the V1/V2 profile the sim currently uses.
  Modeling the V3 interface + burn profile is tracked as
  [SLS-104](https://yanismuzenitov.atlassian.net/browse/SLS-104).

**So:** the sim is faithful to a real, caught configuration (V1/V2), but it is
one generation behind the vehicle now flying (V3). That's a deliberate,
documented boundary, not an oversight.

## Booster flight record (F5–F13, through 2026-07-25)

Sourced/dated summary — the internal citation is the 2026-07-25 audit; the
Flight 12–14 and V3 grid-fin facts are corroborated by the public reporting
linked below.

| Flight | Booster outcome                              | Notes                                    |
| ------ | -------------------------------------------- | ---------------------------------------- |
| F5     | **Caught** (V1/V2 pins)                      | Also the near-abort-to-ground precedent  |
| F6     | Abort to water (in-flight)                   | Tower-side comms issue                    |
| F7     | **Caught**                                   | V1/V2 interface                          |
| F8     | **Caught** (last catch, ~2025-03)            | Last V1/V2 catch before the V3 campaign  |
| F9–F13 | 5 planned water landings (**2 lost**)        | V3 test campaign; e.g. F12 booster lost  |

Tally through 2026-07-25: **3 caught, 1 in-flight abort-to-water, 5 planned
water landings (2 lost).** The ship reached a controlled ocean splashdown on
Flight 13 (2026-07-24), setting up the Flight 14 catch attempt.

## Sources

- SatNews, "SpaceX Targets First Starship Upper Stage Tower Catch for Flight 14"
  (2026-07-25) — https://satnews.com/2026/07/25/spacex-targets-first-starship-upper-stage-tower-catch-for-flight-14/
- TechTimes, "Starship Ship Catch Cleared: Flight 14 to Attempt First Orbital
  Return to Tower" (2026-07-30) — https://www.techtimes.com/articles/322289/20260730/starship-ship-catch-cleared-flight-14-attempt-first-orbital-return-tower.htm
- Space.com, "How SpaceX's new Starship 'V3' differs from its predecessors"
  (three larger grid fins) — https://www.space.com/space-exploration/launches-spacecraft/the-worlds-biggest-rocket-how-spacexs-new-starship-v3-differs-from-its-predecessors
- NASASpaceflight, "Super Heavy Block 3 — the Booster of the Future" (V3 grid
  fins + inner-13 landing-burn redundancy) — https://www.nasaspaceflight.com/2026/05/super-heavy-block-3-booster-future/
- Internal: SLS strategic audit, 2026-07-25 (Wave 2, claims hardening).
