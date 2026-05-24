# `docs/reference/` — reference data the simulator consumes

This folder holds the **machine-consumed reference data** for the Starship landing
simulator: the actual numbers the code reads — Raptor thrust/throttle curves, ISA
atmosphere tables, vehicle mass & geometry, actuator limits, and similar derived
datasets. Everything here is versioned with the code and reviewed via PR, so it can
never silently drift out of sync with the simulator.

## What lives here

- Tabular / numeric reference data the code imports at build or run time
  (e.g. `raptor_thrust.csv`, `isa_atmosphere.csv`, `vehicle_geometry.json`).
- Short notes describing each dataset's units, source, and date checked.

## What does NOT live here

- **Narrative reference** ("how Starship / Raptor work", the catch sequence, reentry,
  attitude control) → the **Confluence knowledge base** (*Starship Reference Knowledge
  Base*, SLS space). Prose, diagrams, and videos belong there, not in the repo.
- **Decisions about the code / architecture** → `docs/adr/` (Architecture Decision Records).

Rule of thumb: *numbers the code loads → here; prose and "why" → Confluence KB;
"we chose X" → an ADR.*

## Provenance

Every dataset should record where its numbers came from and when they were last
verified. Specs (especially Raptor thrust / chamber pressure) evolve between vehicle
versions and sources disagree at the margins — re-verify before relying on a value.

See also: Confluence → *Starship Reference Knowledge Base* →
*Working with Claude on this knowledge base*.
