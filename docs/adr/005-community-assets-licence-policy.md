# ADR-005: Community-sourced 3D assets, CC0/CC-BY only

- **Status:** Accepted (tower-model premise amended by [ADR-018](018-launch-site-environment-sourcing.md))
- **Date:** 2026-07-05 (backfill — decision made ~2026-05-28 with SLS-44;
  the file was never committed, rediscovered in the 2026-07-05 PM audit)
- **Tickets:** SLS-44

> **Amendment (ADR-018, 2026-07-11):** the premise "no licence-clean tower
> model exists" is no longer true — the SLS-56 spike verified two CC-BY 4.0
> Mechazilla kits (Thingiverse `thing:5908857`, `thing:5403074`). The
> licence gate itself is unchanged. The tower nevertheless stays built to
> the physics constants, with CC-BY kit geometry adapted only for visual
> detail — see [ADR-018](018-launch-site-environment-sourcing.md) for why.

## Context

The vehicle and tower are procedural placeholder meshes. They are legible
but wrong in ways that matter for a public demo (proportions, fin shape,
chopsticks), and hand-modelling competitive geometry is out of scope for
this team. Community hubs (Sketchfab et al.) carry good Starship/Super
Heavy models, but community assets carry licence risk: an NC or SA licence
contaminating a permissively-licensed public repo is risk R6 on SLS-43.

## Decision

Replace procedural vehicle meshes with community-sourced GLB assets under
a strict licence gate: **CC0 or CC-BY only. Reject NC and SA variants
outright.** Every imported asset gets its provenance (source URL, author,
licence, retrieval date) recorded in `ASSETS.md` at the repo root, and
CC-BY attribution is surfaced in the app's credits. No licence-clean tower
model exists as of the decision date, so the procedural tower stays until
one appears.

## Consequences

- **Positive:** big visual upgrade for near-zero modelling effort; repo
  stays safe to fork/relicense; provenance is auditable in one file.
- **Negative:** dependent on what the community publishes — the tower stays
  procedural indefinitely; CC-BY imposes an attribution obligation the UI
  must carry.
- **Neutral / follow-up:** asset download requires an authenticated
  Sketchfab session — an owner-in-the-loop step (`awaiting-owner`).

## Alternatives considered

- **Keep procedural meshes** — free of licence risk but visually wrong,
  and modelling effort would keep growing with every geometry bug
  (SLS-40/41/42 were all procedural-mesh bugs).
- **Commission / buy models** — costs money for a hobby project and most
  marketplaces have murkier redistribution terms than CC.
- **Accept CC-BY-NC or CC-BY-SA too** — widens the pool, but NC poisons
  any future commercial use and SA is viral against the repo's permissive
  licence. Rejected as R6.
