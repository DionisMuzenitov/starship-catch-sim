# ADR-012: Headless GLB pipeline & named-node articulation

- **Status:** Accepted
- **Date:** 2026-07-05
- **Tickets:** SLS-44 (adopt community-sourced vehicles); extends ADR-005
- **Relates to:** SLS-40/41/42 (articulation bugs this supersedes)

## Context

SLS-44 adopts clarence365's CC-BY "Ship S25 & Booster 9" model (ADR-005
licence policy). The ticket's written pipeline — "decimate/retopo/split/
re-pivot in Blender" — assumes a Blender GUI. The build environment is
headless with no Blender. Investigation of the model, though, showed most
of that pipeline is unnecessary here.

## Decision

**Headless pipeline** (`tools/assets/build-glb.mjs`, `@gltf-transform`):
`dedup → weld → simplify (meshoptimizer) → prune → Draco`. Reduces the raw
872k-triangle / 34 MB export to ~168k tris / 2.4 MB, preserving the scene
graph (no flatten/join — that would destroy the articulation nodes). The
source model is not committed (it's clarence365's; downloaded from
Sketchfab per ASSETS.md); the committed GLB is the deliverable and the
script documents its provenance. Textures are small (~1.4 MB) and left as-is.

**Articulation by named-node rotation, not Blender re-pivot.** The model's
moving parts are already separate named nodes whose `matrix` places each
part's origin at its mount (grid fins at their hinge radius, Raptors at the
engine plane). So the loaders (`BoosterModelGLB` / `StarshipModelGLB`)
rotate those nodes in code — grid-fin deflection about each fin's radial
hinge axis, engine gimbal about body X/Z, flap deflection about the
tangential hinge — composing each part's rest quaternion with the
state-driven delta. Same props as the procedural models, so callers are
unchanged; a `<VehicleModel>` wrapper renders the GLB inside Suspense + an
error boundary that falls back to the procedural mesh during load or on any
GLB failure.

**Three gotchas that cost the most, recorded so the next asset doesn't
repeat them:**

1. **Node placement is in `matrix`, not TRS.** A first read of
   `node.translation` showed all-identity and suggested pivots at the scene
   origin; the parts are actually placed by a 4×4 `matrix` — pivots are at
   the mounts, which is what makes in-code articulation viable.
2. **three's GLTFLoader sanitizes names** (`PropertyBinding.sanitizeNodeName`:
   whitespace → `_`, `[ ] . : /` stripped). `"Gridfin.001_21"` loads as
   `"Gridfin001_21"`. Look parts up by the sanitized name (`sanitizeName()`).
3. **Sketchfab wraps the scene in an ancestor transform** (`Sketchfab_model`:
   scale 5 + up-axis rotation). Extracting a bare subtree drops it, so the
   vehicle renders at 1/5 size. `extractVehicleRoot()` bakes the subtree's
   parent world matrix back into the clone. All measured world-normalized
   quantities (engine-plane Y, fin height, `MODEL_SCALE ≈ 1.069`) live in
   this post-bake frame.

**Draco decoder is self-hosted** under `public/draco/` (base-path aware) —
no CDN, so it works offline and on the GitHub Pages sub-path (consistent
with ADR-011). The tower stays procedural (no licence-clean tower exists,
confirmed twice in SLS-44 research).

## Consequences

- **Positive:** a large visual upgrade (real Starship/Super Heavy geometry
  with the as-flown 4-fin catch config) with no Blender and no new runtime
  cost beyond the 2.4 MB GLB; articulation resolves the SLS-40/41/42 class
  of pivot bugs; graceful fallback means the sim always renders.
- **Verified:** both vehicles load at correct scale/orientation, zero
  console errors, grid-fin deflection visibly articulates (measured via
  neutral-vs-deflected pixel diff). Pure transform math is unit-tested.
- **Known follow-ups (interactive-tuning, not blockers):** the PBR steel
  reads dark without an environment map (a lightformer-based offline env is
  the fix); ship-flap deflection magnitude is subtle and its hinge
  axis/sign wants a sandbox pass; per-engine gimbal sign is unverified
  visually. These are best tuned with the model on screen; filed as an
  `organic` follow-up.

## Alternatives considered

- **Blender pipeline** (the ticket's literal steps) — not available headless;
  and unnecessary since parts are pre-split with mount-origin pivots.
- **Committing the raw 34 MB model** — unshippable for a browser demo.
- **CDN Draco decoder** (drei default) — blocked offline and mis-pathed under
  the Pages sub-path; self-hosted instead.
- **Flatten/join for fewer draw calls** — would collapse the named nodes and
  kill articulation; rejected.
