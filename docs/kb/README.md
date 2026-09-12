# Knowledge base

Narrative reference for how the real Starship, Raptor engine, catch sequence,
reentry and attitude control work — the grounding behind the simulator's
modelling choices.

> **⚠️ Provenance**
>
> These pages lived in a Confluence space until the free trial ended and the
> product was removed from the Atlassian site (SLS-68). They were recovered from
> the `confluence-kb.json` backup of 2026-08-19 and converted to markdown by
> `tools/kb/convert-kb.mjs` (SLS-118). **This directory is now the canonical copy.**
> Re-run the converter only if the export itself is ever refreshed.

Related in-repo references: [physical reference data](../reference/README.md) ·
[catch provenance](../catch-provenance.md) · [architecture decisions](../adr/README.md).

## Editing these notes (Obsidian)

This directory doubles as an **Obsidian vault** (SLS-120) — an Obsidian vault is
just a folder of markdown files, so no conversion or import is needed:

1. Obsidian → **Open folder as vault** → select `docs/kb`.
2. Edit normally. Changes are plain files; commit them like any other change.

Syncing is git — Obsidian Sync/Publish (both paid) are deliberately not used.

> **⚠️ Keep links markdown-style**
>
> VitePress cannot resolve Obsidian's `[[wikilinks]]`, so writing them would
> break the docs build. `.obsidian/app.json` is committed precisely to pin
> `useMarkdownLinks: true` + relative paths — don't change those settings.
> Everything else under `.obsidian/` is gitignored as per-user state.

## Start here

- [Starship landing simulator Home](starship-landing-simulator-home.md)
- [Starship Reference Knowledge Base](starship-reference-knowledge-base.md)
- [Working with Claude on this knowledge base](working-with-claude-on-this-knowledge-base.md)

## The vehicle & the real manoeuvre

- [How Starship catches itself — overview](how-starship-catches-itself-overview.md)
- [Raptor engine — how it works (full-flow staged combustion)](raptor-engine-how-it-works-full-flow-staged-combustion.md)
- [Attitude control, thrusters & actuators](attitude-control-thrusters-actuators.md)
- [Reentry & thermal protection (heat shield)](reentry-thermal-protection-heat-shield.md)
- [Booster descent aerodynamics — retrograde blunt-body drag & Cd(M)](booster-descent-aerodynamics-retrograde-blunt-body-drag-cd-m.md)
- [Starbase catch site — Pad A/B, dimensions, and catch history](starbase-catch-site-pad-a-b-dimensions-and-catch-history.md)

## Guidance & control

- [Convex powered-descent guidance — the Açıkmese/Blackmore lineage](convex-powered-descent-guidance-the-acikmese-blackmore-linea.md)
- [Learning-based booster control: what worked](learning-based-booster-control-what-worked.md)
- [Reward design for the catch env](reward-design-for-the-catch-env.md)

## Process & decisions

- [Implementing a ticket with Claude Code — research-first session protocol](implementing-a-ticket-with-claude-code-research-first-sessio.md)
- [ADR-005: 3D asset sourcing & pipeline](adr-005-3d-asset-sourcing-pipeline.md)
