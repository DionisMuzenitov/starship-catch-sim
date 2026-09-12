# Reentry & thermal protection (heat shield)

> Migrated from the Confluence SLS space (SLS-118). Confluence was lost when
> the free trial ended (SLS-68); this file is now the canonical copy.
> Source: `confluence-kb.json` export of 2026-08-19, page version 1.

Why a rapidly reusable heat shield is the hardest unsolved problem on Starship, and the engineering constraints behind it. Reference for the ship's atmospheric / reentry phase.

### Source

📺 [Everyday Astronaut — Starbase tour with Elon Musk](https://www.youtube.com/watch?v=aFqjoCbZ4ik) (transcript on file). Paraphrased below.

### The hard problem

Getting to orbit was solved in the 1950s; reuse is the real breakthrough. The single toughest remaining piece is a **rapidly reusable orbital heat shield** — something nobody has ever achieved. The Space Shuttle is the closest precedent, but its tiles took on the order of nine months and thousands of people to refurbish between flights, which doesn't count as rapid. For most of a test-flight year, the primary "payload" is data: surviving max heating, then proving the booster catch and the ship catch.

### The tile-gap problem

Starship's skin is **stainless steel**; the thermal protection is **ceramic tiles** — brittle, like dinner plates, bonded to the steel. The catch is that the two materials move in opposite directions at the wrong times:

- On **ascent**, cryogenic propellant makes the steel shrink, so the tiles are squeezed together.
- On **reentry**, the tanks are empty and the tiles get very hot and want to expand, against a relatively contracted structure.

So the gap between tiles has to be tuned carefully: **too tight and the tiles shatter against each other; too loose and reentry plasma reaches the steel and melts the primary structure.** The right gap even varies across the vehicle, since some areas have cryogenic propellant behind them and some don't.

### Why a missing tile sometimes matters — and sometimes doesn't

- Over **pressurized** sections (the propellant tanks, and the nose), a lost tile can melt through and the pressurized volume **pops** — i.e. the vehicle is lost.
- Over **unpressurized** sections (e.g. the rear), a melt-through just leaves a hole; the vehicle can survive it.

That's why SpaceX has deliberately flown with a few tiles missing in unpressurized areas — an in-flight A/B test of "what happens if we lose a tile here."

### Mitigations discussed

- **Secondary / backup shield:** a new layer beneath the tiles using an **ablative** backup, designed so the vehicle survives a lost tile. The trade: you lose reusability for that flight (the ablative has to be replaced), but the vehicle comes home intact. (Specifics are ITAR-restricted.)
- **Flap-hinge hot-gas seal:** a key risk area (the Shuttle had hinge-gap trouble). Fast hot gas flowing through the fore/aft flap-hinge interface would cook everything, including the tiles — so the hinge needs a working hot-gas seal.
- **Active cooling was considered and dropped:** transpiration / actively-cooled shields were studied years ago but lost the mass trade to ceramic (estimated ~2× heavier at the time). Once the secondary ablative layer is added, the margin narrows — but ceramic is still expected to win, and may be the only viable option for the much hotter reentry coming back from Mars.

### Sources

- [Everyday Astronaut — Starbase tour with Elon Musk](https://www.youtube.com/watch?v=aFqjoCbZ4ik) (YouTube) — transcript on file
- [Space Shuttle thermal protection system](https://en.wikipedia.org/wiki/Space_Shuttle_thermal_protection_system) (Wikipedia) — the closest reusable-TPS precedent
