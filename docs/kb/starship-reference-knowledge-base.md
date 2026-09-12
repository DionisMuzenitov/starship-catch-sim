# Starship Reference Knowledge Base

> Migrated from the Confluence SLS space (SLS-118). Confluence was lost when
> the free trial ended (SLS-68); this file is now the canonical copy.
> Source: `confluence-kb.json` export of 2026-08-19, page version 5.

> **Historical index.** The live index is [`docs/kb/README.md`](README.md); the Confluence page tree this describes is gone.

This is the project's reference knowledge base: notes on how the **real** SpaceX Starship / Super Heavy system actually works — the physical reality the simulator is trying to model. It exists so that when we need a concrete number or behaviour to ground the physics (engine count, gimbal authority, the catch sequence, the atmospheric phase), there is a single place to find it.

**What lives here vs. in ADRs:** Architecture Decision Records (`docs/adr/`, from SLS-5) capture _decisions we make_ about the code. This knowledge base captures _physical reality we are modelling_ — that isn't a decision, it's the world the simulator approximates. Keeping them separate stops the ADRs from filling up with rocket trivia.

### Pages in this knowledge base

- [Working with Claude on this knowledge base](working-with-claude-on-this-knowledge-base.md) — start here: how we expand the KB, capture knowledge, and make/revise decisions with Claude.
- **How Starship catches itself — overview** — the narrative starting point: the vehicle, the catch sequence, reusability/turnaround, and what it means for the simulator.
- **Attitude control, thrusters & actuators** — how the vehicle steers: gimbal, grid fins, flaps, RCS thrusters, and the in-flight ice-clog failure.
- **Raptor engine — how it works (full-flow staged combustion)** — Merlin vs Raptor, why methane, the cycle, a cross-checked spec table, and field notes (with featured video).
- **Reentry & thermal protection (heat shield)** — the ship's atmospheric phase: the tile-gap problem and reusable-TPS challenge.

### Recorded decision (SLS-36)

- ✅ Adopt option 3 from the ticket: use Confluence for media-rich narrative reference ("how Starship works"), and keep machine-consumed reference data (Raptor thrust curves, ISA atmosphere tables, vehicle geometry) in `docs/reference/` in the repo where the code can read it and PRs keep it in sync.

### SLS-36 closeout

- [x] Create `docs/reference/README.md` in the repo describing what data lives there vs. in `docs/adr/` — shipped in [PR #13](https://github.com/DionisMuzenitov/starship-catch-sim/pull/13).

- [x] Add a pointer to this space and to `docs/reference/` from `CLAUDE.md` so future sessions know where to look — shipped in [PR #13](https://github.com/DionisMuzenitov/starship-catch-sim/pull/13).

SLS-36 is now complete. Continued growth of this KB follows the loop on [Working with Claude on this knowledge base](working-with-claude-on-this-knowledge-base.md).
