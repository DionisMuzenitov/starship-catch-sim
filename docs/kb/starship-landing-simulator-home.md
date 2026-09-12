# Starship landing simulator Home

> Migrated from the Confluence SLS space (SLS-118). Confluence was lost when
> the free trial ended (SLS-68); this file is now the canonical copy.
> Source: `confluence-kb.json` export of 2026-08-19, page version 2.

> **Historical.** This was the Confluence space home page. The repo's front door is the top-level `README.md`.

Welcome to the **Starship landing simulator** Confluence space. The simulator itself lives on GitHub at [DionisMuzenitov/starship-catch-sim](https://github.com/DionisMuzenitov/starship-catch-sim) and work is tracked in Jira on the [SLS board](https://yanismuzenitov.atlassian.net/jira/software/projects/SLS/boards/67). This space exists alongside the code as the project's **reference knowledge base** for how the real Starship / Super Heavy / Raptor system actually works.

### Start here

- 📚 [Starship Reference Knowledge Base](starship-reference-knowledge-base.md) — the real index. Every reference page lives under it.
- 🤝 [Working with Claude on this knowledge base](working-with-claude-on-this-knowledge-base.md) — read first if you're going to add content. Conventions for capturing videos / web sources, recording decisions, and revising them.

### What goes where

> **ℹ️ Info**
>
> **Confluence (this space)** — narrative, media-rich reference about the real world we're modelling: vehicle behaviour, engine internals, the catch sequence, atmospheric phase, attitude control.
> **Repo** `docs/reference/` — machine-consumed reference data the simulator actually loads (thrust curves, ISA tables, geometry). Versioned with the code.
> **Repo** `docs/adr/` — architecture decisions about the code itself.

Rule of thumb: _prose and "why" → here; numbers the code loads → repo; "we chose X" → an ADR._
