# Raptor engine — how it works (full-flow staged combustion)

> Migrated from the Confluence SLS space (SLS-118). Confluence was lost when
> the free trial ended (SLS-68); this file is now the canonical copy.
> Source: `confluence-kb.json` export of 2026-08-19, page version 2.

How SpaceX's **Raptor** engine works, why it is built the way it is, and what matters for modelling it in the simulator. Most of the explanation below is distilled from the featured video; the headline numbers are cross-checked against Wikipedia (sources at the bottom).

### Featured video

📺 [This Engine Will Reinvent Space Travel](https://www.youtube.com/watch?v=4K8zt8NzlVo) — "How the SpaceX Raptor engine actually works." A clear walk-through of Merlin vs Raptor, the fuel choice, and the full-flow staged-combustion cycle.

### The big idea: from Merlin to Raptor

SpaceX's earlier **Merlin** engine (Falcon 9) was deliberately simple and cheap: it burns **RP-1** (refined kerosene) with liquid oxygen and uses an **open-cycle gas generator** — a small preburner spins the turbopumps, then dumps its exhaust overboard through a side pipe. That design lineage goes back to the 1944 V-2.

**Raptor** throws that away. The brief for Starship was the opposite of Merlin's: the highest thrust-to-weight ratio of any engine, on a fuel nobody had flown operationally. The result is a **full-flow staged-combustion** engine burning **methane + liquid oxygen (methalox)**.

### Why methane instead of kerosene

Kerosene is a long-chain hydrocarbon that never fully combusts; it leaves carbon residue (**soot / "coking"**) inside the engine. For an expendable engine that's fine, but for one meant to fly again within hours it's a dealbreaker — the soot must be scrubbed out between flights. Methane (one carbon to four hydrogens) burns clean, leaving essentially nothing behind, which is what makes rapid reuse — and a closed cycle — practical. Like oxygen, methane is carried as a cryogenic liquid for density.

### How the Raptor cycle works

- **Two independent turbopumps** — one for oxygen, one for methane — instead of Merlin's single shared shaft.
- **Two preburners.** Almost all the oxygen passes through an oxygen-rich preburner and almost all the methane through a fuel-rich preburner. Each preburner's hot gas spins its own turbine/pump, then flows on into the main chamber. Because _all_ the propellant goes through the preburners, the cycle is called **full flow**.
- **Staged combustion = ignite twice.** Propellants light first in the preburners, then again (now gas-on-gas) in the main combustion chamber.
- **Regenerative cooling.** Cold methane is routed through the walls of the nozzle and chamber first, carrying heat away (keeping the engine from melting) before it reaches its preburner.
- **Closed cycle.** Nothing is vented overboard — that's the only way to hold the enormous internal pressure. The turbopumps must run at even higher pressure than the chamber (~600× atmospheric), or combustion would flow backwards into the tanks.
- **Spin-start from the ground.** Raptor has no onboard helium start system like Merlin; the launch mount externally spins up the turbines, which is why the Starship mount is called "stage zero."

> **📝 Note**
>
> Everything is interconnected: if the methane and oxygen sides drift even slightly out of sync during ignition, the engine destroys itself. That's why ignition is so delicate — and a useful intuition for why the control problem is genuinely hard.

### Headline numbers (Raptor 3)

| Property | Value | Source / note |
| --- | --- | --- |
| Cycle | Full-flow staged combustion (methalox) | First FFSC engine to fly |
| Sea-level thrust | ~280 tf (&asymp;2.75 MN) | Video & Wikipedia agree (R1 ~185 tf, R2 ~230 tf) |
| Chamber pressure | ~330–350 bar (&asymp;4,800–5,000 psi) | Wikipedia lists 330 bar; video states 350 bar for R3 — sources differ, treat as approximate |
| Mixture ratio (O2:CH4) | &asymp;3.6 (&asymp;78% O2 / 22% CH4) | Wikipedia |
| Throttle range | 40–100% | Wikipedia |
| Specific impulse | ~327 s (SL), ~350 s (vac), ~380 s (vac-optimized) | Wikipedia |
| Size | ~3 m tall, ~1.3–1.5 m at the nozzle | Video / Wikipedia — compact enough to fit 33 in the 9 m booster |
| Dry mass (R3) | ~1,525 kg | Wikipedia |

### How it compares

Raptor is small but punches far above its size. The Saturn V's **F-1** made more than double Raptor's thrust but was enormous (you could park a Jeep in it). The Space Shuttle / SLS **RS-25** makes only ~190 tf at roughly twice Raptor's size. Running its chamber at far higher pressure than any other engine is how Raptor achieves its class-leading thrust-to-weight.

### More from the field — Starbase interview (2024)

Additional Raptor detail from the Everyday Astronaut / Musk Starbase tour ([video](https://www.youtube.com/watch?v=aFqjoCbZ4ik)):

- **Autogenous pressurization.** Raptor uses no helium to pressurize the tanks. It generates _gaseous methane_ and _gaseous oxygen_ from the propellants themselves to pressurize the fuel and ox tanks. Making that hot gas from a cryogenic liquid (phase change + a big temperature jump) costs real pump work — it's actually a limiting factor on the fuel pump's max power.
- **Thrust roadmap.** Current Raptor 3 is ~280 tf; the stated long-term target is ~**330–335 tf per engine**, which would give ~**10,000 tf of thrust at liftoff** across 33 engines (~3× Saturn V). Treat the higher figure as a target, not a current spec.
- **Next-gen direction (V3).** The next Raptor needs _no external heat shield_: cooling is integral, with secondary cooling/flow circuits running through each part, and most bolted/welded joints removed (e.g. the big hot-gas manifold flange joining the fuel-pump side to the ox-pump side, which holds enormous pressure). It looks simpler outside but is more complex inside — and harder to service, since some parts are welded shut and must be cut to repair. Today's Raptor can't survive bare in reentry plasma, which is why it's heavily shielded.

### Sources

- Video: ["This Engine Will Reinvent Space Travel"](https://www.youtube.com/watch?v=4K8zt8NzlVo) (YouTube) — transcript on file
- Video: [Everyday Astronaut — Starbase tour with Elon Musk](https://www.youtube.com/watch?v=aFqjoCbZ4ik) (YouTube) — transcript on file; source of the "more from the field" section
- [SpaceX Raptor](https://en.wikipedia.org/wiki/SpaceX_Raptor) (Wikipedia) — used to cross-check specs
- [Staged combustion cycle](https://en.wikipedia.org/wiki/Staged_combustion_cycle) (Wikipedia) — background on the cycle

_Spec figures evolve between Raptor versions and sources disagree at the margins — re-verify any number before relying on it in code._
