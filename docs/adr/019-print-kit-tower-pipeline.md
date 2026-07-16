# ADR-019: Print-kit → GLB tower pipeline and owner-driven visual tuning

- **Status:** Accepted (2026-07-16)
- **Ticket:** SLS-76
- **Extends:** ADR-005 (asset licence policy), ADR-012 (GLB asset pipeline,
  articulation contract)

## Context

The procedural Mechazilla (SLS-22 era) never looked like the real tower, and
no licence-clean *assembled* 3D model of the tower exists: an exhaustive sweep
(Sketchfab / Printables / Thingiverse / NASA-3D, CC0/CC-BY only per ADR-005)
found exactly two qualifying models, both **3D-printing kits** — dozens of
STLs, each centred on its own print bed, no assembly transform data. ADR-012's
pipeline (`build-glb.mjs`) consumes an already-assembled glTF, so it cannot
ingest these.

Two further constraints surfaced during the build:

1. **Assembly knowledge lives in geometry, not metadata.** Which end of a
   chopstick carries the hinge, where the carriage's rail hooks sit, which
   part is a mirror of which — none of this is in the files. It had to be
   *measured* (headless STL cross-sections) and, where measurement was
   ambiguous, *decided by the owner in-sim*.
2. **Agent-driven visual iteration is slow** (screenshot round-trips), while
   owner-driven iteration is fast. Placement/orientation decisions are
   therefore delegated to the owner through live tuning controls, and the
   agreed values are baked as defaults (see `feedback_visual_tuning_tools`
   memory; this ADR makes it a project convention).

## Decision

1. **A bespoke assembler, `tools/assets/build-tower-glb.mjs`,** parses the
   kit's binary STLs and assembles them per a data-driven layout
   (`tower-layouts.mjs`): stacked column segments in the kit's native Z-up mm
   frame, then one global Z-up-mm → Y-up-metres fit to `TOWER_HEIGHT_M`.
   Chopsticks and carriage are placed in *world* space against the physics
   constants (`ARM_HINGE_OFFSET_*`, `DEFAULT_ARM_HEIGHT_M`) so the visual
   arms pivot where the catch geometry expects.
2. **Articulation contract (extends ADR-012):** named nodes
   `LeftChopstick` / `RightChopstick` (origin = the *measured* hinge tube of
   each arm, a full-height vertical cylinder in the part) and `Carriage`.
   The loader (`MechazillaTowerGLB.tsx`) reparents these into an arm group
   and rotates them for open/close; catch points still come from the physics
   module, never the mesh.
3. **Axis-vs-part rule:** when a rotation pivot is wrong but placement is
   approved, move the node origin (axis) to the part — never re-place the
   part under a new axis. (Implemented as `pivotNative` = rotation axis vs
   `anchorNative` = placement anchor in the layout.)
4. **Owner-driven tuning panel** (`?tune=1`, `TowerTunePanel` +
   `towerTuneStore`): tower yaw/offset, arm yaw/opening/height, carriage
   position + full 3-angle rotation, OLM yaw/offset. The panel prints a
   copy-pasteable "bake" line; agreed values are committed as store defaults.
   Owner-baked standard for the MikeNotBrick model (2026-07-16): tower yaw
   47°, dx 11; arm yaw −44°; carriage dx 4, rot 0/180/90°; OLM −13°, dx 15,
   dz 19.
5. **The GLB tower is the default** (`?tower=proc` = procedural fallback).
   Source STLs are *not* committed (CC-BY kit, provenance + re-bake
   instructions in `ASSETS.md`); the ~260 KB Draco GLB is.

## Consequences

- Any future kit (e.g. the herbys 200-part model, deferred) is a new layout
  entry + measurements, not a new pipeline.
- The numpy port is untouched — this is visual-only; physics constants remain
  single-sourced (SLS-28).
- The kit's arm geometry vindicates the physics constants: with arms closed,
  the mirrored pair's inner faces sit at ±4.5 m — exactly flanking a 9 m
  booster.
- Landing/catch alignment: the owner-tuned tower sits offset from the physics
  catch point, so the site would show the booster caught in mid-air. Solution
  (no physics change): a **ghost booster** the owner nests into the visual
  chopsticks (`?tune=1`); the baked position yields `SITE_OFFSET = catch −
  ghost`, a single world shift applied to the whole site group (tower + OLM +
  terrain) so the physics catch drops into the visual cradle. Its +63 m
  vertical component is the "caught too high" fix (the booster's body now runs
  alongside the tower instead of floating base-at-arms). numpy↔TS parity safe.
- The GLB chopstick meshes open to a **visual** max of ARM_ANGLE_OPEN_RAD/2;
  the real print-kit arms over-rotate past that. Mesh-only — catch happens
  closed, where the visual pose and the physics catch points coincide.
