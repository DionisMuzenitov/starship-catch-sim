# Launch-site environment sourcing — comparison note (SLS-56)

Research spike behind [ADR-018](../adr/018-launch-site-environment-sourcing.md).
Every licence claim below was verified against the **primary licence text or
ToS page** by an independent adversarial check on **2026-07-11**; quotes are
from those texts. Site coordinates: Pad A tower ≈ 25.99613 N, 97.15474 W
(see [starbase-site.md](starbase-site.md)).

## 1. Terrain & imagery sources

### Verdict matrix

| Source | Best res. at Boca Chica | Licence | Committable to this repo? |
| --- | --- | --- | --- |
| **USGS 3DEP DEM** | **1 m** (TX_LowerRioGrande_D22, 2022–23 lidar, pub. 2024-09-24) + 1/3″ (~10 m) seamless | US public domain — "free and in the public domain. There are no restrictions" | ✅ yes |
| **NAIP aerial imagery** | **60 cm** 4-band, Texas 2024 (flown May–Nov 2024) | US public domain; TxGIO's 2024 Texas release labelled **CC0-1.0** | ✅ yes |
| **NOAA/USGS coastal lidar** | QL1+ 30 pts/m² point cloud, 2023 campaign; incl. topobathy (2016) and reportedly 10–20 cm ortho deliverables | US public domain | ✅ yes (derived products) |
| **Landsat 8/9** | 30 m (15 m pan-sharpened) | US public domain — "no restrictions… can be used or redistributed as desired" | ✅ yes |
| **SRTM / NASA DEMs** | 30 m, covers the Mexico side | US public domain | ✅ yes |
| **Copernicus DEM GLO-30** | 30 m DSM (2010–14 vintage — predates Starbase) | Bespoke ESA/Airbus licence: redistribution allowed **with** exact credit notice + liability sentence + downstream pass-through; **not CC** | ⚠️ only with recorded ADR-005 exception |
| **Sentinel-2** | 10 m, covers Mexico side, current-year | EU legal notice: permissive, attribution, no NC/SA; **not CC**. (ESA-*published* renders are CC-BY-**SA** — avoid that route) | ⚠️ only with recorded ADR-005 exception |
| **OpenStreetMap** | Starbase richly mapped (547 buildings, both towers with heights, 54 tanks) | ODbL: substantial extracts (≳100 features / systematic pulls) are share-alike derivative databases | ❌ as data. Carve-out: a **handful of coordinates is "insubstantial"** (ODbL §6.2 + OSMF guideline) and obligation-free |
| Google Photorealistic 3D Tiles | photoreal mesh (coverage at Starbase unverified) | GMP ToS §3.2.3(a): no "pre-fetch, index, store, reshare, or rehost"; §3.2.3(c): no "creating content from Google Maps Content"; no caching grant exists in the Service Specific Terms | ❌ never |
| Cesium ion (World Terrain, Bing) | ~30 m+ streamed | "Asset Depot assets … cannot be downloaded or exported"; free tier non-commercial, logo required | ❌ never (stream-only, keyed) |
| Mapbox / MapTiler (terrain-RGB) | ~5–30 m streamed | No redistribution; 30-day device-local cache max (Mapbox); no bulk download (MapTiler) | ❌ never (stream-only, keyed) |
| AWS Open Data Terrain Tiles (Terrarium) | ~10 m (NED-derived at this site) | Open data, US-side sources public domain; tilezen attribution list applies | ✅ conditionally — superseded by 3DEP (higher res, cleaner), useful as a keyless streaming fallback only |

**"No Google Earth rips" — the citable basis** (for ADR-005/R6): Google Geo
Guidelines — "You may not use output, or use third party tools to capture
output, from Google Earth … to reconstruct 3D models or create similar
content"; GMP ToS §3.2.3(c) — no tracing or deriving 3D/terrain models from
Google imagery. Community "photogrammetry" scans of Starbase are typically
Google Earth captures and are contaminated **even when labelled CC** —
provenance must be checked per model.

**Keyless static site:** none of the commercial services work without an
embedded client token. Google additionally requires a billing account
("financially responsible for charges caused by abuse" of a leaked key).
Cesium ion/MapTiler free tiers at least fail closed (quota, no card). All
break forks/offline. Hence: bake, don't stream.

### Sizes that drive the bake (raw → committed)

- 10×10 km @ 1 m DEM ≈ 400 MB raw float32 → committed as a 16-bit PNG
  heightmap at 8–30 m posting (≤ ~1 MB — the site is tidal flats at ~2 m
  ASL, so coarse posting is visually safe; relief is carried by texture,
  and finer posting would fight the 5 MB blob guard for nothing).
- 10×10 km @ 60 cm NAIP ≈ 1.1 GB raw → committed as a mip pyramid,
  ~2.4 m/px at 4096² (~2–4 MB KTX2/JPEG per level), near-pad crop at
  higher px density.
- Wide tier 100×100 km @ 30 m DEM ≈ 2 MB + 20–30 m/px imagery ≈ 5 MB.
- Every US source hard-stops at the Rio Grande (~5 km south): the Mexico
  side of the wide tier needs SRTM + Landsat (pure-PD default) or
  Sentinel-2 (exception variant) — owner A/B in SLS-57.

## 2. Tower / pad / vehicle models

### Licence-verified usable (CC-BY 4.0, per-page verification 2026-07-11)

| Model | Author / platform | What it has | Caveats |
| --- | --- | --- | --- |
| "Starship Launch Tower & Launch Pad with Functional Chopsticks" ([thing:5908857](https://www.thingiverse.com/thing:5908857)) | MikeNotBrick / Thingiverse | Tower, pad, articulated chopsticks + QD arm (1:144 print kit) | Untextured STL solids; tri count unpublished; remove print-only features |
| "High detail, mechanized Mechazilla tower and OLM" ([thing:5403074](https://www.thingiverse.com/thing:5403074)) | herbys / Thingiverse | Highest-detail free tower found; the only CC-BY model that includes an OLM (whole kit is CC-BY 4.0); pulleys, carriage, QD modelled | Resin-detail STLs — likely multi-million tris; aggressive decimation required |
| Starbase Orbital Launch Tower v4.0.1 ([thing:4932584](https://www.thingiverse.com/thing:4932584)) | EvelynH97 / Thingiverse | 2021-era tower | Author notes arms don't match IRL design — fallback only |
| Ship 24 & Booster 7 V4 / Ship S25 & Booster 9 ([Sketchfab](https://sketchfab.com/3d-models/spacex-starship-ship-24-booster-7-v4-97875d14b63e4b9ca9ed425ef4253306)) | Clarence365 / Sketchfab | Textured glTF stacks, ~885 k faces, correct 20-fixed/13-gimbal engine split | S25+B9 already shipped (ADR-012); S24+B7 is the upgrade path |
| "Orbital tank farm Starbase v1" ([printables 133305](https://www.printables.com/model/133305-orbital-tank-farm-starbase-v1)) | Kosmopark / Printables | GSE tank farm | CC-BY per Printables API (single-source read — re-verify at import); 2022 layout; untextured |

CC-BY 4.0 obligations verified against the legal code: attribution must
include **creator + copyright notice + licence name/link + source link +
modification statement** (§3(a)(1)), the asset must be excluded from the
repo's MIT grant, and info removed on licensor request (§3(a)(3)).
Non-compliance auto-terminates the licence (§6(a), 30-day cure).

### Rejected (do not import)

| Candidate | Why rejected |
| --- | --- |
| Anubiz3D "Mechazilla with GSE Tanks" (Printables 151408) | **CC-BY-NC-SA** (verified via Printables API) — NC and SA both violate ADR-005 |
| Josefson "Starship + tower 1:144" (Printables 745422) | **CC-BY-NC(-SA)** — and it is a remix of MikeNotBrick's CC-BY original: go upstream instead |
| hulkbuild tower (Printables 751011) | **CC-BY-NC-SA** — remix of herbys' CC-BY original: go upstream |
| MakerWorld / CrealityCloud Mechazilla mirrors | Licence unverifiable (bot-blocked); snippets suggest NC-SA — rejected until verified |
| Sketchfab Store "Starship Launch & Catch Tower" (5th Dimension), CGTrader towers/facility ($60–195), fab365 OLM | Paid **store licences**: use-in-product only, no redistribution — committing to a public repo *is* redistribution |
| tvthiel "Complete Starship + OLIT" (thing:7083484) | CC-BY-NC-**ND** |
| Spaceport3D "Boca Chica Launch Site" photogrammetry (+ similar scans) | No licence, not downloadable — and the site-scan class ADR-005's rip rule targets; reference-only |
| NASA 3D Resources | Checked 2026-07-11: no SpaceX/Starbase hardware exists there |

(The Printables/MakerWorld/CGTrader candidates surfaced via the owner's
Gemini search are the rows above — every one either NC/SA-blocked, a store
licence, or an NC remix whose **CC-BY upstream original** is already in the
usable table.)

### Route decision (ADR-018 §3)

Physics constants stay canonical (`tower.ts`: 146 m tower, arms at 91 m,
catch point ≈ (8.5, 91, 0)); real Pad A values differ slightly — see the
**arm-length delta note in [starbase-site.md](starbase-site.md)**, which
owns that table. Visual hardware is built **to the sim constants**, with
CC-BY kit geometry adapted for detail and CC0 PBR texturing (ambientCG /
Poly Haven class libraries, triplanar-mapped to avoid UV-unwrapping print
solids).

## 3. Rendering technique (for SLS-57)

- **Terrain:** single displaced-plane patch (10×10 km @ 30 m posting ≈ 111 k
  verts, one draw call) + curved low-res surround skirt (drop ≈ d²/2R) +
  ocean plane. No tile streaming, no 3d-tiles-renderer (that library —
  Apache-2.0, R3F-native — stays the documented fallback if scope grows).
- **Precision:** float32 ULP at 65 km ≈ 8 mm with the tower-origin ENU frame
  — no floating origin needed. `logarithmicDepthBuffer` is already on;
  known cost: disables early-z, MSAA/postFX edge cases — SLS-61 measures;
  dynamic near-plane is the documented alternative.
- **Sky:** keep the existing altitude-keyed gradient + starfield; add
  curved-horizon treatment. drei `<Sky>` (Preetham) is ground-level-only —
  wrong above ~10 km. `@takram/three-atmosphere` (MIT, Bruneton) is the
  future upgrade but Beta + mid-rewrite — deferred.
- **Textures:** KTX2/ETC1S for drapes (≈JPEG size on disk, 4–8× less VRAM;
  transcoder wasm ~0.5 MB, Apache-2.0); JPEG acceptable first pass.
- **LOD:** drei `<Detailed>` for discrete objects (tower/OLM/tanks);
  `gltf-transform simplify` (meshoptimizer) for offline decimation ratios.

## 4. Payload budget

The normative budget lives in [ADR-018 §4](../adr/018-launch-site-environment-sourcing.md)
(env total / per-file / critical-path caps — the per-file cap is the
existing CI blob guard). Context behind it — GitHub Pages limits
(primary-source, 2026-07-11):
1 GB site, 100 GB/month soft bandwidth, 100 MB/file hard — at 25 MB cold
load that's ~4 000 uncached loads/month, comfortable. Current shipped
payload for context: stack GLB 2.24 MB + policy JSON 1.53 MB + Draco
decoder 0.76 MB.

## 5. Flagged uncertainties (verify at bake time; none change the decision)

1. NAIP 2024 Texas GSD: 60 cm confirmed in metadata read, but some 2023–24
   state acquisitions flew 30 cm — check the actual tile header; if 30 cm,
   near-tier quality doubles for free.
2. The 2023 USGS lidar deliverables reportedly include 10–20 cm ortho +
   building footprints/models (NOAA InPort 76197) — PD upgrade path for the
   near-pad crop and licence-free footprints; confirm availability when
   baking.
3. TxGIO's CC0-1.0 label for 2024 NAIP: single-source read — re-verify on
   the TxGIO DataHub page when downloading (federal PD status holds
   regardless).
4. NAIP delivery channels are gated (AWS requester-pays / EarthExplorer
   account): if programmatic download blocks the bake script, the USGS
   NAIPPlus WMS ("map services … are free and in the public domain") is the
   fallback; worst case the download is an `awaiting-owner` step.
5. Kosmopark tank-farm licence rests on one API read — re-verify at import.
6. DEM vertical datum: 3DEP is NAVD88; geoid offset here ≈ −25 m vs WGS84
   ellipsoid — the bake must normalise to "pad apron = y 0".
