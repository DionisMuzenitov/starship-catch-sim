# Architecture Decision Records

This directory holds the project's **Architecture Decision Records (ADRs)** — short documents that capture _why_ a non-trivial decision was made, not just _what_ the code does.

## Why ADRs

Code shows the current state. Git history shows the diff. Neither answers: _"why did we choose this over the obvious alternative?"_ ADRs fill that gap. Six months from now, when someone (often future-you) asks "why don't we just use X?", the ADR explains what was already considered and rejected.

## Format

We use **MADR-lite** — see `template.md`. Every ADR has:

- **Title** — kebab-case file name, `NNN-short-decision.md`
- **Status** — Proposed / Accepted / Superseded by ADR-XXX
- **Context** — what forces are at play, why we have to decide now
- **Decision** — the actual choice, stated clearly
- **Consequences** — what changes as a result, including the bad parts
- **Alternatives considered** — at least two, with the reason each was rejected

Keep them to ~150–300 words. They are signposts, not essays.

## Rules

1. **One decision per file.** If your ADR has more than one decision, split it.
2. **Immutable.** Once accepted, an ADR is never edited beyond fixing typos. If the decision changes, write a new ADR that _supersedes_ the old one — link both ways.
3. **Numbered sequentially.** `001`, `002`, `003`, … never reuse a number.
4. **Reference from code** when the ADR governs a non-obvious convention. E.g. an ESLint rule that enforces ADR-004 should have a comment `// see docs/adr/004-engine-agnostic-physics.md`.

## Adding a new ADR

```bash
cp docs/adr/template.md docs/adr/00N-your-decision.md
```

Fill it in, open a PR, and link the PR from the relevant Jira ticket. Reviewers focus on the _Alternatives_ section — if it's thin, the decision probably hasn't been stress-tested.

## Index

| #   | Title                                                                                              | Status   |
| --- | -------------------------------------------------------------------------------------------------- | -------- |
| 001 | [Tech stack](001-tech-stack.md)                                                                    | Accepted |
| 002 | [6-DOF state and 3D rendering from day one](002-6dof-and-3d-from-day-one.md)                       | Accepted |
| 003 | [Controller interface](003-controller-interface.md)                                                | Accepted |
| 004 | [Engine-agnostic physics core](004-engine-agnostic-physics.md)                                     | Accepted |
| 005 | [Community-sourced 3D assets, CC0/CC-BY only](005-community-assets-licence-policy.md)              | Accepted |
| 006 | [Cascaded PID as the controller baseline](006-cascaded-pid-baseline.md)                            | Accepted |
| 007 | [Convex MPC guidance — 3-DOF SOCP + PID inner loop](007-convex-mpc-guidance.md)                    | Accepted |
| 008 | [MPC in the browser — WASM port plan](008-mpc-wasm-port.md)                                        | Accepted |
| 009 | [Coast-phase ignition planning (coast+burn)](009-coast-burn-guidance.md)                           | Accepted |
| 010 | [Terminal-dock control laws for dispersion robustness](010-terminal-dock-dispersion-robustness.md) | Accepted |
| 011 | [Static demo hosting on GitHub Pages](011-static-demo-hosting.md)                                  | Accepted |
| 012 | [Headless GLB pipeline & named-node articulation](012-glb-asset-pipeline-and-articulation.md)      | Accepted |
| 013 | [RL numpy physics port, single-sourced constants & parity](013-rl-numpy-port-and-parity.md)        | Accepted |
| 014 | [PPO training pipeline — vectorized plant, curriculum, DR](014-ppo-training-pipeline.md)           | Accepted |
| 015 | [Attitude inner loop, cascade teacher & BC campaign](015-attitude-inner-loop-and-bc-campaign.md)   | Accepted |
| 016 | [Pure-TS policy runtime (JSON weights, no ONNX)](016-ts-policy-runtime.md)                         | Accepted |
| 017 | [Defer the global leaderboard to post-launch demand](017-leaderboard-defer.md)                     | Accepted |
