# How Starship catches itself — overview

> Migrated from the Confluence SLS space (SLS-118). Confluence was lost when
> the free trial ended (SLS-68); this file is now the canonical copy.
> Source: `confluence-kb.json` export of 2026-08-19, page version 3.

> **Overlap:** the V1/V2-vs-V3 catch-interface and flight-record sections are maintained in [`docs/catch-provenance.md`](../catch-provenance.md) (SLS-99). This page is the plain-language mental model.

A plain-language overview of how SpaceX's Starship returns and "catches" its first stage, written as grounding for the simulator. The goal here is the _mental model and the rough numbers_, not flight-grade fidelity — for anything the code actually consumes, see `docs/reference/` in the repo. The repo mirror of the provenance below is `docs/catch-provenance.md`.

### The vehicle in one paragraph

Starship is a fully reusable, two-stage launch system. The lower stage, **Super Heavy**, is the booster: it carries 33 **Raptor** engines burning liquid methane and liquid oxygen ("methalox"). The upper stage — confusingly also called **Starship**, or just "Ship" — rides on top and continues toward space after the booster separates. The stack launches from, and the booster returns to, the same tower at Starbase in South Texas.

### Why a "catch" instead of landing legs

Falcon 9 lands on deployable legs. Super Heavy does not: legs strong enough to hold a booster this large would be heavy (eating into payload) and would slow the turnaround between flights. Instead SpaceX catches the booster in mid-air using two large arms on the launch tower — the "chopsticks," on a tower SpaceX calls **Mechazilla**. Catching at the pad keeps that mass off the vehicle and is meant to enable rapid re-flight.

### The catch sequence

1. **Boostback.** After stage separation the booster flips and relights a subset of its engines to reverse course back toward the launch site.
2. **Coast & descent.** It falls back through the atmosphere at supersonic speed, using grid fins to steer and bleed energy aerodynamically.
3. **Landing burn.** A handful of central engines relight to brake hard, slowing the booster to a near-hover beside the tower.
4. **The catch.** The vehicle positions itself precisely between the tower arms, which close to cradle it just below the grid fins. Roughly seven minutes elapse from liftoff to catch.

**What this means for the simulator.** The interesting, controllable physics all live in steps 2–4: gimbaled thrust from a subset of engines, grid-fin aerodynamic control, the timing and throttle profile of the landing burn, and the tight terminal geometry of arriving between the arms at near-zero velocity. This is exactly the regime our PID / MPC / RL controllers have to solve — and it's why M1's wind & turbulence model matters, since a real catch has to reject gusts on the way down.

### Reusability & turnaround — the point of the catch

The catch isn't a stunt; it's what makes _rapid_ reuse possible. From the Starbase interview, the intended booster cadence: it comes back and lands ~5–6 minutes after liftoff, can be back on the launch mount within ~5–10 minutes, refilled in ~30 minutes, and ready to fly again roughly an hour later. The ship is slower to recycle because it has to wait for a ground track that brings it back over the launch site — potentially several orbits, hours to half a day — so at max launch rate you'd want roughly **five ships per booster**. For contrast, Falcon 9 lands a booster downrange on a drone ship and takes days to refurbish; Starship's goal is to take that from days to hours.

Payload scale, for context: Starship V2 targets ~100 t to orbit reusable; later stretched/optimized versions aim for 200 t+ to a useful orbit fully reusable (~twice Saturn V). These test flights are mostly about answering design questions — surviving max heating, proving the booster catch, proving the ship catch — with data as the real payload.

### Flight-test milestones & booster record (F5–F13)

_Updated 2026-08 (SLS-99). The well-covered early catches (F5, F7) are firmly sourced; the finer per-flight tally (F6/F8 and the V3 water-landing campaign) comes from the 2026-07-25 SLS strategic audit (fact-checked, two corrections adopted) and is corroborated for F12–F14 by the public reporting linked below. Per-flight outcomes move fast — re-verify anything load-bearing._

- **Flight 5 — 13 Oct 2024:** the first-ever successful booster catch by the tower arms; the headline proof the concept works.
- **Flight 6:** in-flight **abort to water** — a tower-side comms issue waved the booster off to a Gulf splashdown. (Terminology: SpaceX's "divert" names the _planned_ move away to the water; a _post-commit_ late abort instead targets the ground beside the tower, as in the Flight 5 near-abort — a distinct manoeuvre.)
- **Flight 7 — Jan 2025:** second successful booster catch (the upper-stage Ship was lost separately on that flight).
- **Flight 8 — ~Mar 2025:** third successful booster catch — and the **last** catch to date. Every catch so far used the **V1/V2** vehicle.
- **Flights 9–13:** with the **V3** ("Block 3") vehicle debuting, the booster campaign switched to **planned water landings** (test-and-verify before catching V3). Of these five, **two boosters were lost** — e.g. Flight 12 (V3 debut) struck the Gulf at ~1,450 km/h with only a single landing-burn engine lit. On **Flight 13 (24 Jul 2026)** the **Ship** reached a controlled ocean splashdown (3-engine flip → 2 → 1), clearing the way for a ship catch.
- **Flight 14 (announced 25 Jul 2026):** SpaceX will attempt the **first-ever Ship (upper-stage) catch** at the tower — which, because the Ship must return from orbit, will also be **Starship's first orbital flight** (payload: operational V3 Starlink). Pending regulatory approval.

**Booster tally through 2026-07-25:** 3 caught (F5/F7/F8), 1 in-flight abort-to-water (F6), 5 planned water landings (2 lost).

### What's caught, and what the simulator still models by analogy

- **The booster catch is flight-proven; the ship catch is not.** No Ship catch has ever been flown (first attempt = Flight 14). The sim's ship catch envelope is therefore **speculative** — grounded only by analogy to the booster catch and the Flight 13 splashdown sequence. Revisit after Flight 14 flies.
- **The sim models the V1/V2 catch interface** (pins under the grid fins — the only configuration ever caught). **V3 differs**: three larger grid fins that _are_ the catch interface (no separate pins), and a **13 → 5 → 3** landing-burn engine step-down. So the sim is faithful to a real, caught configuration but is one vehicle generation behind what flies now. Modeling the V3 interface + burn profile is tracked as SLS-104.

### Sources (2026 additions)

- SatNews — [SpaceX Targets First Starship Upper Stage Tower Catch for Flight 14](https://satnews.com/2026/07/25/spacex-targets-first-starship-upper-stage-tower-catch-for-flight-14/) (2026-07-25)
- TechTimes — [Starship Ship Catch Cleared: Flight 14 to Attempt First Orbital Return to Tower](https://www.techtimes.com/articles/322289/20260730/starship-ship-catch-cleared-flight-14-attempt-first-orbital-return-tower.htm) (2026-07-30)
- [Space.com](http://Space.com) — [How SpaceX's new Starship 'V3' differs from its predecessors](https://www.space.com/space-exploration/launches-spacecraft/the-worlds-biggest-rocket-how-spacexs-new-starship-v3-differs-from-its-predecessors) (three larger grid fins)
- NASASpaceflight — [Super Heavy Block 3 — the Booster of the Future](https://www.nasaspaceflight.com/2026/05/super-heavy-block-3-booster-future/) (V3 grid fins + inner-13 landing-burn redundancy)

### Related KB pages

- **Attitude control, thrusters & actuators** — how the booster/ship actually steer (gimbal, grid fins, flaps, RCS).
- **Reentry & thermal protection** — the ship's heat-shield problem during the atmospheric phase.
- **Raptor engine — how it works** — the engines doing the boostback and landing burn.

### Reference links

**Official**

- [SpaceX — Starship vehicle page](https://www.spacex.com/vehicles/starship/)

**Wikipedia**

- [SpaceX Starship](https://en.wikipedia.org/wiki/SpaceX_Starship) — system overview and integrated flight history
- [SpaceX Raptor](https://en.wikipedia.org/wiki/SpaceX_Raptor) — the methalox engine
- [List of Starship upper-stage flight tests](https://en.wikipedia.org/wiki/List_of_Starship_upper_stage_flight_tests) — the early (2019–2021) prototype hop/landing campaign
- [SpaceX Starbase](https://en.wikipedia.org/wiki/SpaceX_Starbase) — the launch and catch site

**Video**

- [Everyday Astronaut — Starbase tour with Elon Musk](https://www.youtube.com/watch?v=aFqjoCbZ4ik) — source for the reusability/turnaround figures above
- [Space.com — Flight 5 catch (video)](https://www.space.com/spacex-starship-flight-5-launch-super-heavy-booster-catch-success-video)
- [ScienceAlert — the catch moment (video)](https://www.sciencealert.com/watch-amazing-moment-as-spacex-catches-giant-starship-booster)
- [CNN — second catch on Flight 7](https://www.cnn.com/2025/01/16/science/spacex-starship-megarocket-test-launch)

This page is intentionally a _starting point_. Add deeper pages as children as we gather material — e.g. "Grid fins & aerodynamic control", "Catch geometry & tower arm dynamics".
