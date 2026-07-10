# ADR-017: Defer the global leaderboard to post-launch demand

- **Status:** Accepted
- **Date:** 2026-07-10
- **Tickets:** SLS-70 (this ADR), SLS-31 (M7 hosted demo + leaderboard — re-scoped), SLS-69 (product thesis)

## Context

SLS-31 (M7) bundles two things: the hosted public demo (already live via
SLS-49 / ADR-011, GitHub Pages) and a **global leaderboard** — shared
writable state, replay-hash anti-cheat verification, and player-name
submission. A leaderboard would be the project's first stateful,
abuse-exposed, cost-bearing component, and it would land right before the
launch-traffic spike that M7 is meant to attract.

Two forces make this a decision, not a build task:

1. **It contradicts ADR-008.** ADR-008 rejected keeping any always-on
   backend precisely for "cost, cold starts, abuse surface," and chose a
   browser-native WASM solver so the demo stays a static site. A writable
   leaderboard backend reintroduces exactly what ADR-008 designed away.
2. **SLS-69 set the thesis to portfolio / hiring-signal.** The load-bearing
   assets are visual polish, demo quality, and the engineering-judgment
   trail (ADRs, results, write-up). A global leaderboard serves the
   _community-toy_ audience, which SLS-69 ranked secondary.

Per the CLAUDE.md step-2 rule, an ADR-bearing feature with an abuse surface
must be red-teamed before it's locked in — done below.

## Decision

**Ship M7 with no leaderboard.** Keep client-local personal bests only if
and when they're cheap; do not stand up any shared backend for launch.
Re-scope SLS-31 to the hosted-demo scope it already largely satisfies, and
mark the leaderboard **deferred — post-launch, demand-gated**.

**Revisit trigger (explicit):** if the launch generates _sustained_ demand
for global competition (repeated asks across HN / Reddit / issues, not a
one-off), reconsider Alternative B below — a serverless-KV backend with
deterministic replay verification, rate limits, and no free-text names.
Until that signal appears, the leaderboard stays unbuilt.

## Red-team (why deferring is the correct call at design time)

Standing up the leaderboard for launch fails on its own gate — "a
trustworthy public board that survives launch traffic" — for reasons
foreseeable now, not at bench time:

- **Anti-cheat is load-bearing and non-trivial.** A credible board must
  reject forged runs. Deterministic replay verification needs the physics
  core running server-side (or in a Worker via the WASM core that ADR-008
  hasn't shipped yet) plus HMAC-signed replays with the seed in the MAC.
  That's a real subsystem to build, test, and secure — during the busiest,
  least-attended week of the project.
- **Free-text names are a moderation surface.** Any public submission field
  invites spam and abuse; moderating it is unbounded human toil the solo
  owner can't staff at a launch spike.
- **The payoff is misaligned with the audience.** For the portfolio thesis,
  a working, beautiful, well-documented demo is the artifact hiring managers
  evaluate; a leaderboard adds operational risk without adding to that
  signal. Deferring costs almost nothing and removes the single riskiest
  launch dependency.

## Consequences

- **Positive:** M7 stays a static site (ADR-008/011 honored) — zero backend,
  zero cost, zero abuse surface, nothing to keep alive. Launch effort
  concentrates on demo polish + write-up, the load-bearing thesis assets.
- **Positive:** removes the project's riskiest unbuilt component from the
  critical path; SLS-31 collapses to "already largely done."
- **Negative:** no social competition loop at launch — the community-toy
  audience gets less. Accepted per SLS-69's ranking.
- **Neutral / follow-up:** SLS-31 re-scoped to the demo-hardening slice
  (OG card, robots/sitemap, Play CTA) with the leaderboard split out as
  deferred + demand-gated. If the trigger fires, a _new_ ticket implements
  Alternative B; this ADR is its starting point.

## Alternatives considered

- **A — Client-local leaderboard (localStorage personal bests).** Zero
  backend, ships in a day, honors ADR-008. Rejected _as the headline
  feature_ because it isn't a global board (no competition), but it's the
  natural cheap consolation if we want any "best run" UI — folded into the
  demo scope, not gated behind this defer.
- **B — Serverless-KV backend (Cloudflare Workers KV/D1) + replay
  verification.** The "right" way to build a real global board: free tier,
  deterministic replay anti-cheat, per-IP rate limits, handle allow-listing
  instead of free text. Rejected _for now_ — it's the exact backend ADR-008
  avoided, and building/securing it into a launch spike is disproportionate
  to the portfolio payoff. This is the option the revisit trigger reopens.
- **C — Build the full SLS-31 leaderboard as originally specified, for
  launch.** Rejected: maximum operational risk (state + anti-cheat +
  moderation) at the worst possible time, serving the secondary audience.
