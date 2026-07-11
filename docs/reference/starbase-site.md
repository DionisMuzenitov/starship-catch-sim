# Starbase catch-site reference — Pad A catch era (2024–25)

Dimensional reference for the launch-site environment (SLS-56/57,
[ADR-018](../adr/018-launch-site-environment-sourcing.md)). The sim depicts
the **Pad A configuration as flown for the three real catches**
(B12 2024-10-13, B14 2025-01-16, B15 2025-03-06). Pad A was decommissioned
2025-10-14 and its chopsticks/OLM demolished — this file records the
historical configuration deliberately.

Confidence: **[S]** sourced · **[D]** derived/estimated (assembled from
sourced numbers or footage — do not present as spec) · **[U]** unpublished,
photo-reference only. All values retrieved/cross-checked 2026-07-11; source
list at bottom.

## Pad A tower (OLIT-A)

| Quantity | Real value | Sim constant (`packages/physics/src/tower.ts`) |
| --- | --- | --- |
| Tower structure height | 143 m (469 ft FAA figure) [S] | `TOWER_HEIGHT_M = 146` |
| + lightning rod | +10 ft → ~146 m total [S] | (146 matches rod-inclusive height) |
| Lattice sections | 9 bolted truss sections ≈ 15.9 m each [S/D] | — (render: 9 sections) |
| Footprint | ~12–13 m square [S, OSM-traced ±1–2 m] | `TOWER_FOOTPRINT_M = 12` |
| Structure | open lattice, concrete-filled corner chords, unpainted dark steel [U — photo] | — |
| Chopstick arm length | ~36 m each, ~5.5 m structural depth [S] | `ARM_LENGTH_M = 30` — **known delta**, see note |
| Arm carriage | "spine + ribcage with skates" on 3 tower chords, drawworks + pulleys [S] | — |
| Arm plane at catch | ~85–90 m AGL (booster base ≈ OLM-deck level in footage) [D] | `DEFAULT_ARM_HEIGHT_M = 91` |
| QD arm | pivot ~80–90 m [D]; swings clear during catch [S] | — (render: decorative) |

**Arm-length delta note:** visuals conform to the sim's 30 m arms (physics
canonical — the trained policy and catch detection depend on this geometry).
Re-sourcing to 36 m is a physics change, out of M8 scope.

## Orbital launch mount (Pad A, as flown 2023–25)

| Quantity | Value |
| --- | --- |
| Type | circular ring on 6 concrete-filled steel legs [S] |
| Height above pad | ~20 m [S, medium confidence] |
| Mount ring assembly mass | 370 t; 20 hold-down clamps [S] |
| Ring diameter | not published — model from imagery, opening > 9 m booster [U] |
| Deluge | water-cooled perforated steel plate (added mid-2023, post-IFT-1) [S] |

## Site layout (tower-origin ENU frame; +X = chopstick side, +Y up)

| Feature | Position / distance | Confidence |
| --- | --- | --- |
| Pad A tower centre (origin) | 25.99613 N, 97.15474 W | [S — OSM-traced, ±2–5 m; insubstantial extract, see licence note] |
| Pad B tower centre | 25.99705 N, 97.15807 W — ~349 m WNW (~287°) of Pad A | [S/D — computed from coordinates] |
| Tower → OLM offset | ~25–30 m centreline-to-centreline | [D — unpublished; arms are 36 m and "extend beyond the OLM"] |
| Gulf shoreline | ~430 m east of Pad A tower | [S/D] |
| Highway 4 | nearest point ~200 m NNE; dead-ends at Boca Chica Beach | [S/D] |
| OLS tank farm | ~370 m row along the north side (Hwy 4): CH₄ ~110–160 m NE of Pad A, then LOX, LN₂, water westward toward Pad B; ~5 m-dia vertical cylinders [U for tank sizes] | [S — OSM positions / U — dimensions] |
| Rio Grande / Mexico border | ~5 km south — every US dataset (3DEP/NAIP/NOAA) stops there | [S] |
| Terrain | tidal/salt flats, ~2 m ASL, shrub-height vegetation only; Starbase build site ~2.3 km west; Brownsville ~27 km west | [S] |

## Catch mechanism (Block 1/2 boosters, as simulated)

- Catch pins on the interstage just below the four grid fins, near booster
  top (~69–71 m station of a 71 m booster) [S]; pins land on extendable
  rails atop the arms; lateral capture window ~1–2 m [S].
- Deceleration profile for reference: ~1 000 km/h → 0 in ~30 s, brief hover
  beside the tower before lateral capture [S].
- (Block 3, out of scope: 72.3 m booster, three grid fins at 90/90/180 that
  are themselves the catch points.)

## Licence notes

- Numeric facts are not copyrightable; each is sourced below.
- The two tower-centre coordinates are OSM-traced — an **insubstantial**
  extract (ODbL §6.2 / OSMF Substantial Guideline: <100 features), carrying
  no ODbL obligations; credited as courtesy: © OpenStreetMap contributors.
  Do **not** bulk-import OSM geometry (547 buildings = substantial =
  share-alike; blocked by ADR-005).
- Fandom wiki text is CC-BY-**SA** — used only as a pointer; nothing
  reproduced verbatim.

## Sources (retrieved 2026-07-11)

- FAA 469 ft tower + 10 ft rod:
  <https://www.cnbc.com/2021/07/14/faa-warns-spacex-it-has-not-approved-new-texas-launch-site-tower.html>
- Tower/site overview + 370 t OLM, tank capacities, catch dates (citation
  index): <https://en.wikipedia.org/wiki/SpaceX_Starbase>,
  <https://en.wikipedia.org/wiki/Starship_flight_test_5>,
  <https://en.wikipedia.org/wiki/Starship_flight_test_12>
- Pad 2 design, arm differences, deluge figures:
  <https://nasaspaceflight.com/2025/08/starbase-pad-2-advancements-pad-1/>
- Pad 1 demolition / rebuild series:
  <https://www.nasaspaceflight.com/2025/10/starbase-pad-1-demolition-upgrades/>,
  <https://www.nasaspaceflight.com/2025/10/pad-1-era-preparations-next-phase/>,
  <https://www.nasaspaceflight.com/2025/11/spacex-starship-pad-realignment-future/>,
  <https://www.nasaspaceflight.com/2026/02/starbases-launch-site-double-size/>,
  <https://www.nasaspaceflight.com/2026/03/progress-starbase-pads-block-3-starships/>
- Block 3 booster / Flight 12:
  <https://www.nasaspaceflight.com/2026/05/starship-flight-12-block-3-pad-2/>,
  <https://www.nasaspaceflight.com/2026/05/super-heavy-block-3-booster-future/>
- 36 m arms, arm install:
  <https://www.teslarati.com/spacex-starship-launch-tower-mechazilla-catch-arm-installation/>;
  QD arm install:
  <https://www.teslarati.com/spacex-starship-launch-tower-mechazilla-arm-installed/>
- Catch mechanism walkthrough:
  <https://spacenexus.us/blog/how-spacex-catches-rockets-mechazilla>
- Flight 5 catch numbers:
  <https://www.skyatnightmagazine.com/news/spacex-starship-test-5-chopsticks>,
  <https://ia.acs.org.au/article/2024/spacex-catches-starship-booster-mid-air.html>
- Coordinates / footprints / tank positions (insubstantial extract):
  <https://www.openstreetmap.org/way/968227813> (Pad A),
  <https://www.openstreetmap.org/way/1207227015> (Pad B), Overpass API
- Site elevation: <https://en-us.topographic-map.com/map-483wgp/Starbase/>
- Fandom (pointer only, CC-BY-SA — nothing copied):
  <https://starship-spacex.fandom.com/wiki/Orbital_Launch_and_Integration_Tower_(OLIT)>

Narrative history + the same table with commentary: Confluence KB page
"Starbase catch site — Pad A/B, dimensions, and catch history" (SLS space).
