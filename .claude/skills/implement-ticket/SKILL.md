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
   will NOT do).
5. STOP and wait for explicit approval before building.

After approval:

6. Create branch `sls-XX-short-slug`. Build against the agreed plan. Keep
   physics constants single-sourced (numpy ↔ TS parity, SLS-28).
7. Verify: typecheck + related tests green (the PostToolUse hook enforces
   this), full suite before finishing.
8. Commit with smart-commit syntax (`$ARGUMENTS #in-progress …`,
   final: `$ARGUMENTS #done …`).
9. Update docs: comment on the ticket (what was learned/decided), KB page if
   vehicle knowledge changed, new ADR for architectural choices.
