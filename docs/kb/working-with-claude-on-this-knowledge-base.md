# Working with Claude on this knowledge base

> Migrated from the Confluence SLS space (SLS-118). Confluence was lost when
> the free trial ended (SLS-68); this file is now the canonical copy.
> Source: `confluence-kb.json` export of 2026-08-19, page version 1.

> **Historical.** These conventions describe adding pages to the Confluence space, which no longer exists. New reference knowledge now goes into `docs/` in the repo — see `CLAUDE.md`.

This page is our working agreement for how we (you + Claude) grow and use this knowledge base. The goal: a living reference we expand over time, keep genuinely useful, and actually use to make and revise decisions — not a graveyard of dumped links.

### The loop

Everything here runs on one cycle:

1. **Expand** — add knowledge from videos, the web, papers, or our own working notes.
2. **Capture** — distil it into our own words on a page, always keeping the source link.
3. **Decide** — when the knowledge informs a choice, record it as a decision.
4. **Revise** — when new knowledge contradicts an old decision, supersede it (don't silently erase the old one).

### Where things live

- **This KB (Confluence)** — narrative, media-rich reference about the real world we're modelling (how Starship / Raptor work, the catch, the atmosphere). Reference knowledge, not code decisions.
- **ADRs (**`docs/adr/`**)** — decisions about the code and architecture.
- **Repo reference data (**`docs/reference/`**)** — machine-consumed numbers the simulator actually reads (thrust curves, ISA tables, geometry), versioned with the code.

Rule of thumb: _prose and "why" → here; numbers the code loads → repo; "we chose X" → an ADR._

### Adding a video

A bare YouTube link is close to useless six months from now, so for each video we:

- Keep the link _and_ the title.
- Have Claude pull the actual knowledge into the relevant page — the claims, numbers, and mechanisms — in our own words.
- Paste a transcript if you have one (best quality); if not, Claude web-searches for reliable descriptions of the video's content instead.
- Cross-check any hard numbers against an authoritative source before treating them as fact (see below).

Worked example: the **Raptor engine page** — one video, fully unpacked into mechanism + a cross-checked spec table.

### Adding info from the web

- Claude searches, then summarises in our own words (no copy-pasted walls of text).
- **Always record the source and the date it was checked.**
- Prefer primary / authoritative sources (SpaceX, Wikipedia, papers) over aggregators.
- **Flag volatile or contested facts.** Real example from the engine page: Raptor 3 chamber pressure is 330 bar on Wikipedia but stated as 350 bar in a video — so we record both and mark it approximate rather than pretending we know.

### Recording and revising decisions

- Decisions live as Confluence _decision items_ (DECIDED / UNDECIDED) on the relevant page, each with a one-line rationale and a date.
- Link the related Jira issue (e.g. SLS-36) so the trail connects.
- To change our mind: add a **new dated decision that supersedes the old one**, and mark the old entry as superseded. We keep the history — knowing _why_ we changed course is the valuable part.

### Page conventions

- Every page opens with one line: "what this is."
- New topic pages are children of the KB index and get added to its contents list.
- Keep prose tight; put hard numbers in tables with a source column.

### How to ask Claude

Plain language is enough. Things that work well:

- "Add this video to the KB" (+ link, + transcript if you have one).
- "Research [topic] and add a page under the KB."
- "We're reconsidering [decision] — review the KB and propose a revision."
- "What does the KB say about [topic]?" — Claude can read these pages back before answering or writing code.

> **ℹ️ Info**
>
> **Repo tie-in:** add a short pointer in `CLAUDE.md` to this KB and to `docs/reference/` so Claude Code sessions know the knowledge base exists and follow these same conventions. (Tracked as an open item on SLS-36.)
