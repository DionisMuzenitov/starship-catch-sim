# Starship Catch Simulator — Claude context

Open-source 6-DOF browser sim of the Super Heavy booster catch. pnpm monorepo:
Vite + React + R3F + TS strict; Vitest + fast-check + Playwright; physics core
shared between TS and a numpy port (parity is load-bearing — SLS-28).

## Project tracker (Jira)

- **Site:** `yanismuzenitov.atlassian.net`
- **Project key:** `SLS` (default project — assume SLS unless told otherwise).
- **Board:** https://yanismuzenitov.atlassian.net/jira/software/projects/SLS/boards/67

When using the Atlassian MCP tools, pass `cloudId: "yanismuzenitov.atlassian.net"`. All `mcp__claude_ai_Atlassian_Rovo__*` tools are pre-allowed in `.claude/settings.local.json` — do not ask for permission per call.

## Project memory (reconstruct context from here, not chat history)

- **SLS-43 "[PM] Command Center"**: description = current status snapshot;
  comments = append-only decisions log. Skim it at the start of every session.
- Confluence space **SLS**: knowledge base (vehicle reference), ADR narrative
  mirrors. Canonical ADRs live in `docs/adr/`.
- Risks live in SLS-43 (R1 physics-port drift, R6 asset licence contamination,
  etc.).

## GitHub

- **Repo:** https://github.com/DionisMuzenitov/starship-catch-sim (public)
- **Owner:** `DionisMuzenitov` (note: differs in case from local Mac user `dionismuzenitov`)
- `gh` CLI is installed and authenticated for this account with scopes `gist, read:org, repo, workflow`. Git uses `gh` as credential helper (`gh auth setup-git` already run).
- For GitHub operations (issues, PRs, CI status) use the `gh` CLI — it is already authenticated.
- Workflow: from SLS-5 onward, each ticket gets its own feature branch + PR. Direct commits to `main` are only for bootstrap.

## Implementation protocol (research-first — applies to EVERY ticket)

Before writing or changing any code for a ticket, you MUST:

1. **INVESTIGATE.** Read the Jira ticket in full. Read the linked Confluence KB
   pages and any `docs/reference/` + `docs/adr/` files it touches. If the
   ticket concerns real Starship / Super Heavy behaviour (physics, engines,
   aero, control, geometry), search the web for current authoritative sources
   and ground your understanding in them. Do not rely on memory for vehicle
   facts.
2. **CRITIQUE.** State explicitly: is the ticket correct, complete, and
   current? Call out anything wrong, missing, oversimplified, or stale. (Past
   examples: constant-Cd drag ignored the transonic/supersonic regime; "all
   engines gimbal" was wrong — only the inner 13 do.)
   For ADR-bearing tickets, red-team the design against the ticket's
   quantitative acceptance gate before locking the ADR: can this formulation
   physically meet the gate? (Past example: ADR-007's 3-DOF planner could
   never close a metres-scale catch through seconds-scale attitude lag —
   predictable at design time, found at bench time.)
3. **PROPOSE.** Give a short implementation plan: approach, key decisions and
   trade-offs, test strategy, and what you will NOT do. Note any deviation
   from the ticket and why.
4. **CONFIRM.** Pause for the owner to approve the plan before building. Do
   not skip this for non-trivial tickets.
5. **BUILD.** Implement against the agreed plan. Keep shared physics constants
   single-sourced (numpy ↔ TS port parity — SLS-28).
6. **UPDATE DOCS.** Record what you learned + decisions in: a comment on the
   Jira ticket, the relevant KB page, and (for architectural choices) a new
   ADR in `docs/adr/`. Leave breadcrumbs for the next session.
7. **CLOSE THE LOOP.** Refresh the SLS-43 description snapshot (phase,
   done/total counts, next, blockers) and append a run-report comment with a
   metrics block: wall-clock duration, tickets touched, PRs opened/merged,
   test-count delta, cost/tokens if known. A stale snapshot is this
   project's worst recorded process failure — do not skip this step.
   **Loop-closure guard:** before ending a session that touched board or
   repo state, verify the newest SLS-43 comment is dated *today* — if the
   latest comment is on an earlier date, the run-report was never posted and
   the loop is not closed.
   When a milestone outcome gate flips (or its status/scope changes), also
   refresh the **README milestone table + Results section** in the same pass
   — the public README is the project's front door and went stale for a full
   milestone once (M6 shipped while the README still said "Planned", SLS-63).
   And **cut a `vX.Y` GitHub release** at the gate-meeting commit (SLS-67):
   tag it, attach the winning checkpoint + the committed
   `eval/results/gate-records/` for that gate, and paste the bench numbers +
   seed/config into the notes — the release is the durable, citable pin for
   the claim (`git`/main moves on; a shallow clone won't have the history).

Use `/implement-ticket SLS-XX` to start a ticket session with this protocol.

## Verification (non-negotiable)

- After every meaningful code change, run typecheck + the tests related to the
  changed files. A **PostToolUse hook** (`.claude/hooks/verify-change.sh`)
  does this automatically after every `Edit`/`Write` on a `.ts`/`.tsx` file —
  if it reports failures, fix them before moving on. Never end a session with
  red tests.
- New physics/control code needs property tests (fast-check) where invariants
  exist, and must not break the numpy ↔ TS snapshot equivalence suite.

## Git / Jira conventions (smart commits)

- Branch per ticket: `sls-XX-short-slug` (from SLS-5 onward; direct commits to
  `main` are only for bootstrap).
- Reference the ticket in every commit message so Jira auto-links and
  transitions, e.g.:
  - `SLS-23 #in-progress cascaded PID skeleton`
  - `SLS-23 #done gain-tuning panel + live charts. #comment tuned defaults per KB`
- Never commit assets without licence provenance (ADR-005): CC0 / CC-BY only,
  attribution recorded in `ASSETS.md`, reject NC / SA.

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
- **Substantive Jira completion comments.** After every merge, post a
  Jira comment summarising what shipped, deviations from the ticket,
  verification done, and the merged commit SHA — not just a bare PR
  link.
- **Each ticket is its own feature branch + PR;** if a follow-up bug is
  spotted during review, file a new ticket rather than amending the merged
  PR.
- **Milestone-done = outcome gate met.** Closing a milestone's tickets does
  not close the milestone. Each milestone's quantitative gate is recorded in
  the SLS-43 snapshot (e.g. M5: ≥50 % catch rate on the MC bench); a
  milestone with green tickets and a red gate is still open.
- **Organic tickets.** Before filing a new ticket from the build seat,
  search the board for an existing one covering the scope (SLS-46 duplicated
  SLS-22 this way). Label build-seat self-filed tickets `organic`; the PM
  seat triages that label each session.
- **Human-blocked work is labelled `awaiting-owner`** so PM sessions can
  start from that filter instead of rediscovering the bottleneck.

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

## Research policy

Web search is allowed and expected (see `.claude/settings.json` permissions).
For vehicle facts: prefer primary / authoritative sources, cross-check numbers,
and write findings into the Confluence KB or `docs/reference/` — sourced, dated.

## Working notes

- Node 20 is keg-only on this machine — prepend `/opt/homebrew/opt/node@20/bin` to `PATH` for `pnpm`/`node`.
- When pulling a Jira issue list, request a narrow `fields` set (`["summary", "status", "issuetype", "priority"]`) — the full payload exceeds the tool result limit.
