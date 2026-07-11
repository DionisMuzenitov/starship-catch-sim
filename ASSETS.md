# Asset provenance

Licence policy: **CC0 / CC-BY only** — see
[ADR-005](docs/adr/005-community-assets-licence-policy.md). Every asset
committed to this repo gets a row here *in the same PR*; no row, no merge.

| Asset | Source | Author | Licence | Retrieved | Notes |
| ----- | ------ | ------ | ------- | --------- | ----- |
| `apps/web/public/assets/starship-stack.glb` (Ship S25 + Booster 9) | [Sketchfab](https://sketchfab.com/3d-models/spacex-starship-ship-s25-booster-9-f76be07d358f454b8396d4e8f1cc5329) | clarence365 | CC-BY-4.0 | 2026-07-05 | Decimated 872k→168k tris + Draco via `tools/assets/build-glb.mjs` (SLS-44 / ADR-012). Vehicles only; tower stays procedural. |
| `apps/web/public/assets/terrain/*.height.png`, `*.drape.a.jpg` | [USGS 3DEP](https://www.usgs.gov/3d-elevation-program) (DEM) + [USDA NAIP](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip) (imagery), both via public WMS | USGS / USDA FSA | US public domain — "no restrictions"; courtesy credit requested | 2026-07-11 | Baked via `tools/assets/bake-terrain.mjs` (SLS-57 / ADR-018); no-coverage areas (open Gulf, Mexico side) filled procedurally. Credit: U.S. Geological Survey; USDA Farm Service Agency. |
| `apps/web/public/assets/terrain/*.drape.b.jpg` | [Copernicus Sentinel-2 L2A](https://registry.opendata.aws/sentinel-2-l2a-cogs/), scenes S2B_14RPP/14RPQ_20241121 | ESA / Copernicus | [Sentinel data legal notice](https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice) — permissive, **not CC**; carried as a *provisional* ADR-005 exception pending the owner drape A/B (ADR-018 §2). Removed if variant A is chosen. | 2026-07-11 | "Contains modified Copernicus Sentinel data 2024." Catch-era scene (2024-11-21, <0.01 % cloud). If variant B ships permanently, surface this notice in app credits and record the exception here as final. |

## Required attribution

Per CC-BY-4.0, reproduced verbatim from the model's `license.txt`:

> This work is based on "SpaceX Starship Ship S25 & Booster 9"
> (https://sketchfab.com/3d-models/spacex-starship-ship-s25-booster-9-f76be07d358f454b8396d4e8f1cc5329)
> by clarence365 (https://sketchfab.com/clarence365) licensed under CC-BY-4.0
> (http://creativecommons.org/licenses/by/4.0/)

## Trademark note

"SpaceX", "Starship", "Super Heavy", and "Mechazilla" are trademarks of
Space Exploration Technologies Corp. This project is an unofficial,
non-commercial educational simulation and is not affiliated with or
endorsed by SpaceX. A CC licence covers the model's copyright only, not
these marks; their use here is nominative/descriptive.
