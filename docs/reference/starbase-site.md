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

FAA 469 ft + 10 ft rod via CNBC 2021-07-14; Wikipedia (SpaceX Starbase,
flight-test articles — as citation index); NASASpaceflight 2025-08-19
(Pad 2 advancements), 2025-10 (Pad 1 demolition ×2), 2025-11 (pad
realignment), 2026-02 (site doubling), 2026-03 (Block 3 progress), 2026-05
(Flight 12, Block 3 booster); Teslarati 2021-10-10 (36 m arms), 2021-08-29
(QD install); SpaceNexus 2026-03-18 (catch mechanism); skyatnightmagazine /
acs.org.au (Flight 5 catch numbers); OSM ways 968227813 / 1207227015 +
Overpass (coordinates, tank positions); topographic-map.com (site
elevation); starship-spacex.fandom.com (pointer only). Full URLs in the
SLS-56 Jira comment and Confluence KB page "Starbase catch site — Pad A/B".
