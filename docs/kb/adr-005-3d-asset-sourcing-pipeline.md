# ADR-005: 3D asset sourcing & pipeline

> Migrated from the Confluence SLS space (SLS-118). Confluence was lost when
> the free trial ended (SLS-68); this file is now the canonical copy.
> Source: `confluence-kb.json` export of 2026-08-19, page version 1.

> **This page is a narrative mirror, not the decision of record.** The canonical ADR is [`docs/adr/005-community-assets-licence-policy.md`](../adr/005-community-assets-licence-policy.md); if the two disagree, the ADR wins.

## ADR-005: 3D asset sourcing & pipeline

**Status:** Accepted (2026-05-28) — owner decision in PM session #3.
**Canonical home:** this decision must be committed to the repo at `docs/adr/005-3d-asset-sourcing.md` (tracked as an acceptance criterion on SLS-44). This Confluence page is the narrative mirror.
**Related:** SLS-44 (implementation), SLS-15 / SLS-16 (superseded procedural approach), SLS-40 / SLS-41 / SLS-42 (geometry bugs likely resolved/superseded here).

### Context

M2 shipped procedurally-generated low-poly meshes for the Booster + Starship (SLS-15) and the Mechazilla tower (SLS-16). In practice the procedural geometry is low fidelity and is generating a string of geometry/DOF bugs (SLS-40/41/42). The owner researched community resources and found abundant, higher-quality SpaceX models available for free.

The goal of this project is a **real-time, browser-based 6-DOF simulator** — not an offline render. That distinction drives the whole decision.

### Decision

Adopt **community-sourced visual meshes** for the vehicles and tower, processed through an **asset pipeline**, while **retaining our own articulation rig**. We do not simply drop in downloaded models; we source the _look_, and keep ownership of the _motion_.

### Why this is not just "download a model"

1. **Real-time &ne; render-grade.** The best-looking community models are built for offline rendering and are explicitly flagged as not optimized for real-time, with triangle counts in the hundreds of thousands. These must be decimated/retopologized to a sane in-browser budget.
2. **Articulation is the real requirement.** A static hull does not solve our problem. The simulator needs correctly-separated, correctly-pivoted parts for gimbaled engines, folding grid fins, articulated flaps, and tower chopsticks. This is the same root cause as bugs SLS-40/41/42 — so sourcing models only helps if we re-rig them.
3. **Controller binding must not change.** The new loader components must expose the same props the procedural models did (`position`, `attitude`, `engineStates[]`, `surfaceStates[]`) so nothing downstream in the controller architecture breaks.

### License policy (binding for an open-source repo)

- **Prefer CC0** (public domain) → then **CC-BY** (attribution recorded).
- **Reject CC-BY-NC** — non-commercial clauses are incompatible with an open-source licence.
- **Avoid CC-BY-SA** unless deliberately accepted — share-alike is viral and can force-license our own work.
- Record every asset's **source URL, author, and licence** in `ASSETS.md` / `NOTICE`.
- SpaceX names and likeness ("Starship", "Super Heavy", "Raptor", "Mechazilla") are **trademarks**. Acceptable for a non-commercial educational/fan simulator; include a disclaimer that the project is unaffiliated with SpaceX.

### Pipeline

Source (GLB, vetted licence) → Blender (decimate/retopo, split into named pivoted sub-meshes) → export GLB → Draco compression → `useGLTF` loader component (same props as before) → re-rig articulation driven by sim state.

### Consequences

- **Positive:** higher visual fidelity for less hand-modelling; geometry bugs likely retired; clear licence hygiene for an OSS release.
- **Negative / cost:** introduces a Blender step and an asset-licence audit; re-rigging articulation is real work (not free with the download); adds a binary-asset management concern to the repo (consider Git LFS).
- **Fallback:** if no suitably-licensed, riggable, real-time model exists for a component, keep the procedural geometry as the rig skeleton and drape sourced detail over it. Decide per component.

### Alternatives considered

- **Keep procedural only** — rejected: low fidelity, ongoing bug tail.
- **Drop in render-grade models as-is** — rejected: kills browser frame rate and still lacks correct articulation.
- **Commission/model from scratch in Blender ourselves** — rejected for now: high effort, not the owner's intent.

### Candidate sources (to be license-vetted in SLS-44)

- **Sketchfab** — many free downloadable Starship/Super Heavy models; glTF export native to three.js; check each model's licence individually.
- **BlenderKit** — community library integrated into Blender; per-asset licence varies.
- **CC0 packs** (Gumroad/itch.io) — good for generic parts (engine bells, greebles); Starship-specific CC0 is rarer.
