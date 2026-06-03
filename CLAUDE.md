# Starship Catch Simulator — Claude context

## Project tracker (Jira)

- **Site:** `yanismuzenitov.atlassian.net`
- **Project key:** `SLS`
- **Board:** https://yanismuzenitov.atlassian.net/jira/software/projects/SLS/boards/67

When using the Atlassian MCP tools, pass `cloudId: "yanismuzenitov.atlassian.net"`. All `mcp__claude_ai_Atlassian_Rovo__*` tools are pre-allowed in `.claude/settings.local.json` — do not ask for permission per call.

## GitHub

- **Repo:** https://github.com/DionisMuzenitov/starship-catch-sim (public)
- **Owner:** `DionisMuzenitov` (note: differs in case from local Mac user `dionismuzenitov`)
- `gh` CLI is installed and authenticated for this account with scopes `gist, read:org, repo, workflow`. Git uses `gh` as credential helper (`gh auth setup-git` already run).
- Workflow: from SLS-5 onward, each ticket gets its own feature branch + PR. Direct commits to `main` are only for bootstrap.

## Working agreements

- **Never merge a PR without explicit user approval.** Green CI is not
  approval. Open the PR, surface the CI result, wait. Phrases like
  "merge it", "ship it", "you can merge", "approved" are approval;
  ambiguous replies are not. Approval is per-PR and does not roll over
  to the next one.
- **Milestone collection review.** For multi-ticket milestones (M2, M3,
  …) prefer a single end-of-milestone review over per-ticket approvals:
  bring every ticket to "CI green, awaiting approval", then prepare one
  sandbox + checklist the user can walk through in one sitting.
- **Research-first for real-world geometry, vehicle reference, or
  physics constants.** Anything involving Starship / Super Heavy /
  Raptor / Mechazilla / atmosphere / orbital mechanics: check the
  Confluence KB first; if it's silent, web-search authoritative sources
  (SpaceX press kits, presentations, reputable space journalism);
  backfill the KB with what you learned (own words, source links + dates)
  before or during the implementation PR. Don't guess real-world details.
- **Substantive Jira completion comments.** After every merge, post a
  Jira comment summarising what shipped, deviations from the ticket,
  verification done, and the merged commit SHA — not just a bare PR
  link.
- **Each ticket is its own feature branch + PR** (already stated above);
  if a follow-up bug is spotted during review, file a new ticket rather
  than amending the merged PR.

## What this repo is

Real-time browser simulation of SpaceX's Starship booster "Mechazilla" catch manoeuvre — 6-DOF rigid-body dynamics, grid-fin + engine-gimbal control, MPC strategies. pnpm workspace: `apps/web` (Three.js/React), `packages/physics`, `packages/controllers`, `services/mpc`. See `README.md` for milestones.

## Knowledge base & reference material

Reference knowledge for this project lives in two places — check them before grounding
any physical numbers or modelling decisions:

- **Confluence — Starship Reference Knowledge Base** (SLS space): narrative / media
  reference for how the real Starship, Raptor engine, catch sequence, reentry, and
  attitude control work. Start at the **"Working with Claude on this knowledge base"**
  page for conventions (how we add videos / web info, record sources + dates, and
  make or revise decisions).
- **`docs/reference/`**: machine-consumed reference data the simulator actually reads
  (thrust curves, ISA atmosphere tables, geometry). See `docs/reference/README.md`.

Decisions about the code / architecture go in `docs/adr/` (not the KB).
When you learn something reference-worthy from a video, paper, or the web, capture it
in the Confluence KB (in our own words, with the source link and date) rather than
letting it evaporate.

## Working notes

- Node 20 is keg-only on this machine — prepend `/opt/homebrew/opt/node@20/bin` to `PATH` for `pnpm`/`node`.
- When pulling a Jira issue list, request a narrow `fields` set (`["summary", "status", "issuetype", "priority"]`) — the full payload exceeds the tool result limit.
