---
name: implement-ticket
description: Implement an SLS Jira ticket using the research-first protocol (investigate → critique → propose → confirm → build → update docs). Use when the user asks to implement, pick up, or work on a ticket like SLS-23.
argument-hint: "SLS-XX"
---

Implement Jira ticket **$ARGUMENTS** for the Starship Catch Simulator.

Follow the research-first protocol from CLAUDE.md. Concretely, BEFORE any code:

1. Read $ARGUMENTS in full via the Atlassian MCP (project SLS,
   site yanismuzenitov.atlassian.net). Include comments.
2. Skim SLS-43 "[PM] Command Center" — current phase, decisions log, risks —
   and any Confluence KB pages or docs/reference/ + docs/adr/ files the
   ticket touches.
3. If the ticket concerns real vehicle behaviour (physics, engines, aero,
   control, geometry), search the web for authoritative sources. Do not rely
   on memory for vehicle facts.
4. Report back: what the ticket gets right, what is wrong/missing/stale, and
   your implementation plan (approach, trade-offs, test strategy, what you
   will NOT do). If the plan locks an ADR, include a red-team paragraph:
   why this design can physically meet the ticket's acceptance gate.
5. STOP and wait for explicit approval before building.

After approval:

6. Create branch `sls-XX-short-slug`. Build against the agreed plan. Keep
   physics constants single-sourced (numpy ↔ TS parity, SLS-28). If you need
   a new ticket mid-build, search the board for an existing one first, and
   label anything you file `organic`.
7. Verify: typecheck + related tests green (the PostToolUse hook enforces
   this), full suite before finishing. **Then run local `/code-review` on
   the diff before opening the PR** and address its findings (or note why
   deferred) — this is the mandatory review gate that replaces the removed
   cloud PR-reviewer workflow (SLS-73).
8. Commit with smart-commit syntax (`$ARGUMENTS #in-progress …`,
   final: `$ARGUMENTS #done …`).
9. Update docs: comment on the ticket (what was learned/decided), KB page if
   vehicle knowledge changed, new ADR for architectural choices.
10. Close the loop on SLS-43: append a run-report comment with a metrics
    block (duration, tickets touched, PRs opened/merged, test-count delta,
    cost if known) and refresh the description snapshot if board state
    changed (counts, phase, blockers).
11. **Loop-closure guard — do not end the session until this passes.**
    Confirm the newest SLS-43 comment is dated **today**: i.e. step 10's
    run-report was actually appended. A session that changed board or repo
    state but left SLS-43's latest comment on an earlier date has NOT closed
    the loop — this is the project's worst recorded process failure (a stale
    snapshot went undetected for a full milestone). If the dates don't match,
    post the run-report before stopping.
