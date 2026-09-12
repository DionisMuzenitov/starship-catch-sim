# Implementing a ticket with Claude Code — research-first session protocol

> Migrated from the Confluence SLS space (SLS-118). Confluence was lost when
> the free trial ended (SLS-68); this file is now the canonical copy.
> Source: `confluence-kb.json` export of 2026-08-19, page version 1.

## Implementing a ticket with Claude Code — research-first session protocol

This is the working agreement for **how a build session (Claude Code, terminal) should pick up and implement an SLS ticket.** It exists because, left to default, Claude Code sometimes just implements what the ticket literally says instead of first checking whether the ticket is _right_. For a physics/aerospace sim grounded in real vehicle behaviour, "investigate, then decide, then build" is mandatory — several tickets have already turned out to be incomplete or subtly wrong (e.g. constant-Cd drag missing the supersonic regime → SLS-45; engine gimbal subset / landing-burn sequencing → KB update 2026-05-28).

### The rule

**No ticket goes straight to code.** Every implementation session runs: **Investigate → Critique → Propose → Confirm → Build → Update docs.** The investigation output is written down (ticket comment + KB), not kept in the model's head.

### Where this should live (so sessions don't need re-explaining)

1. `CLAUDE.md` in the repo — auto-loaded by Claude Code every session. This is the durable mechanism; put the protocol below in it once and every session inherits it. (The owner edits the repo; Claude on [claude.ai](http://claude.ai) cannot.)
2. **This page** — the canonical human-readable copy; `CLAUDE.md` can link here.
3. **Per-session kickoff prompt** — a short paste that points the session at a specific ticket. Kept minimal precisely because the standing rules live in `CLAUDE.md`.

### `CLAUDE.md` block to paste (standing rules)

```
## Implementation protocol (research-first — applies to EVERY ticket)

Before writing or changing any code for a ticket, you MUST:
1. INVESTIGATE. Read the Jira ticket in full. Read the linked Confluence KB
   pages and any docs/reference/ + docs/adr/ files it touches. If the ticket
   concerns real Starship/Super Heavy behaviour (physics, engines, aero,
   control, geometry), search the web for current authoritative sources and
   ground your understanding in them. Do not rely on memory for vehicle facts.
2. CRITIQUE. State explicitly: is the ticket correct, complete, and current?
   Call out anything wrong, missing, oversimplified, or stale. (Past examples:
   constant-Cd drag ignored the transonic/supersonic regime; "all engines
   gimbal" was wrong — only the inner 13 do.)
3. PROPOSE. Give a short implementation plan: approach, key decisions and
   trade-offs, test strategy, and what you will NOT do. Note any deviation
   from the ticket and why.
4. CONFIRM. Pause for the owner to approve the plan before building. Do not
   skip this for non-trivial tickets.
5. BUILD. Implement against the agreed plan. Keep shared physics constants
   single-sourced (numpy<->TS port parity — SLS-28).
6. UPDATE DOCS. Record what you learned + decisions in: a comment on the Jira
   ticket, the relevant KB page, and (for architectural choices) a new ADR in
   docs/adr/. Leave breadcrumbs for the next session.

Project memory lives in Jira (board + PM Command Center SLS-43) and this
Confluence space — not in chat history. Reconstruct context from there.
The default project is SLS (Starship Catch Simulator).
```

### Per-session kickoff prompt (copy-paste, fill in the ticket key)

```
We're working on the Starship Catch Simulator (Jira project SLS). Implement ticket SLS-XX.

Follow the research-first protocol in CLAUDE.md. Concretely, before any code:
1. Read SLS-XX in full (and its linked KB pages / docs it touches).
2. Skim the PM Command Center SLS-43 for current phase, decisions log, and risks.
3. If it touches real vehicle behaviour, search the web and ground it in sources.
4. Tell me: what the ticket gets right, what's wrong/missing/stale, and your
   implementation plan with trade-offs and test strategy.
Then STOP and wait for my go-ahead before building.
```

If the session can't reach Jira/Confluence directly, the owner pastes the ticket text and links; the protocol is otherwise identical.

### Notes on mechanism

- **Jira/Confluence access from Claude Code:** requires the Atlassian MCP server configured in the local Claude Code, or manual paste. Worth setting up so the kickoff prompt stays one line.
- **Keep the kickoff prompt short on purpose.** Anything you'd otherwise repeat every session belongs in `CLAUDE.md`, not the prompt.
- **The CONFIRM step is the point.** It's the gate that was missing — it forces a decision before implementation instead of after.
