# Starbase catch site — Pad A/B, dimensions, and catch history

> Migrated from the Confluence SLS space (SLS-118). Confluence was lost when
> the free trial ended (SLS-68); this file is now the canonical copy.
> Source: `confluence-kb.json` export of 2026-08-19, page version 1.

> **Catch-history overlap:** the flight-by-flight record here is also maintained, with sources and dates, in [`docs/catch-provenance.md`](../catch-provenance.md) (SLS-99) — prefer that page for what is flight-proven vs. speculative. This page's value is the *site geometry*.

## Starbase catch site — Pad A/B, dimensions, and catch history

_Researched 2026-07-11 for SLS-56 (M8 launch-site environment). All numbers verified against the sources listed per-section — do not rely on memory; the site changed drastically in 2025–26. The sim depicts the **Pad A 2024–25 catch era** (ADR-018)._

### The headline state change (mid-2026)

- **Pad A (OLP-1)** hosted every launch through Flight 11 (2025-10-13) and **all three real booster catches**. It was decommissioned **2025-10-14**; chopsticks, OLM, and QD arm were demolished for a V3-era rebuild (flame trench, Pad-2-style stronger mount, enlarged deluge farm). As of 2026-07-11 it is a construction site; return to service possible during 2026. _(NASASpaceflight Oct 2025–Mar 2026 series; Wikipedia SpaceX Starbase)_
- **Pad B (OLP-2)** is the **only operational, only catch-capable pad**: tower ~144.5 m (~1–1.5 m taller than Pad A's), ~11.6 m footprint, chopsticks ~10 m **shorter** than Pad A's and reinforced (single sled + telescopic pusher, 6 rigging passes, load-tested to 700 t in May 2025), **cuboid** launch mount (installed 2025-05-12) over a stainless-lined flame trench with double-sided water-cooled diverter, two BQDs on the mount. First launch: Flight 12 (2026-05-22 UTC, first Block 3 stack B19+S39 — booster lost after staging, planned Gulf splashdown, **not** a catch attempt despite one aggregator's claim). Flight 13 targeted 2026-07-14, no catch planned. **Zero catches at Pad B so far.** _(NASASpaceflight 2025-08-19, 2026-05; Wikipedia Flight 12)_

### Catch history (all at Pad A)

| Flight | Booster | Date | Notes |
| --- | --- | --- | --- |
| 5 | B12 | 2024-10-13 | First catch; ~1,000 km/h → 0 in ~30 s, brief hover, lateral capture window ~1–2 m |
| 7 | B14 | 2025-01-16 |   |
| 8 | B15 | 2025-03-06 | Third and (as of mid-2026) last catch |

Mechanism (Block 1/2): catch **pins on the interstage just below the four grid fins** land on extendable rails atop the arms. Block 3 (B19+, current): 72.3 m booster, **three** grid fins at 90/90/180 mounted lower, and the **fins themselves are the catch points** — no separate pins. _(NSF 2026-05; SpaceNexus 2026-03-18)_

### Pad A dimensions (the configuration the sim renders)

| Quantity | Value | Confidence |
| --- | --- | --- |
| Tower structure | 143 m (FAA 469 ft) + 10 ft lightning rod &asymp; 146 m total | Sourced (FAA via CNBC 2021-07-14) |
| Sections | 9 bolted lattice-truss sections (&asymp;15.9 m each) | Sourced / derived |
| Footprint | ~12–13 m square | OSM-traced ±1–2 m |
| Chopstick arms | ~36 m long, ~5.5 m deep, carriage on 3 tower chords, drawworks + pulleys | Sourced (Teslarati 2021-10-10; SpaceNexus 2026-03-18) |
| Arm plane at catch | ~85–90 m AGL | **Derived from footage — no published figure** |
| OLM | Ring on 6 concrete-filled legs, ~20 m tall, 370 t, 20 clamps; ring diameter unpublished | Mixed |
| QD arm | Pivot ~80–90 m (derived); swings clear during catch | Derived |

**Sim deltas (physics stays canonical, ADR-018):** sim tower 146 m (rod-inclusive ✓), sim arms 30 m vs real 36 m, sim catch plane 91 m vs real ~85–90 m. Re-sourcing arm length would change catch dynamics under the trained policy — deliberately out of M8 scope.

### Site layout

- Pad A tower &asymp; 25.99613 N, 97.15474 W; Pad B &asymp; 25.99705 N, 97.15807 W — **349 m WNW**. (OSM-traced, insubstantial extract, &copy; OpenStreetMap contributors.)
- Gulf shoreline ~430 m east of Pad A; Hwy 4 ~200 m NNE, dead-ends at Boca Chica Beach; Rio Grande / Mexico ~5 km south; build site ~2.3 km west; Brownsville ~27 km west.
- OLS tank farm: ~370 m row along Hwy 4 (CH₄ nearest Pad A, then LOX, LN₂, water toward Pad B); 95,000 gal LOX / 80,000 gal LCH₄ tank capacities reported; individual tank dimensions unpublished (~5 m dia from photos).
- Terrain: tidal/salt flats at ~2 m ASL, shrub vegetation only — visually a flat plane with water east.

### Sourcing & licence cautions for this page

- OSM coordinates: insubstantial ODbL extract (<100 features) — obligation-free, credited as courtesy. **Never bulk-import OSM geometry** (547 buildings = substantial = share-alike, conflicts with ADR-005).
- Fandom wiki ([starship-spacex.fandom.com](http://starship-spacex.fandom.com)) is CC-BY-**SA**: pointer only, nothing copied verbatim.
- FAA figures are US-PD but [faa.gov](http://faa.gov) blocks fetches — cited via CNBC/NSF reporting.
- Key sources: NASASpaceflight (2025-08-19 Pad 2 advancements; 2025-10 Pad 1 demolition; 2025-11 realignment; 2026-02 site doubling; 2026-03 Block 3; 2026-05 Flight 12 + Block 3 booster), Wikipedia (Starbase, Flight 5/12), Teslarati (2021 arm/QD installs), SpaceNexus (2026-03-18 catch mechanism), OSM ways 968227813 / 1207227015, [topographic-map.com](http://topographic-map.com) (elevation).

**Repo counterparts:** `docs/adr/018-launch-site-environment-sourcing.md` (decision), `docs/reference/launch-site-sourcing.md` (licensing matrix), `docs/reference/starbase-site.md` (dimension table the code/bake reads).
