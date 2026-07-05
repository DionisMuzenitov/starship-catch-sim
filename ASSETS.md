# Asset provenance

Licence policy: **CC0 / CC-BY only** — see
[ADR-005](docs/adr/005-community-assets-licence-policy.md). Every asset
committed to this repo gets a row here *in the same PR*; no row, no merge.

| Asset | Source | Author | Licence | Retrieved | Notes |
| ----- | ------ | ------ | ------- | --------- | ----- |
| `apps/web/public/assets/starship-stack.glb` (Ship S25 + Booster 9) | [Sketchfab](https://sketchfab.com/3d-models/spacex-starship-ship-s25-booster-9-f76be07d358f454b8396d4e8f1cc5329) | clarence365 | CC-BY-4.0 | 2026-07-05 | Decimated 872k→168k tris + Draco via `tools/assets/build-glb.mjs` (SLS-44 / ADR-012). Vehicles only; tower stays procedural. |

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
