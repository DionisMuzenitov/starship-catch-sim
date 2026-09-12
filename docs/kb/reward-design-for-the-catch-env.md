# Reward design for the catch env

> Migrated from the Confluence SLS space (SLS-118). Confluence was lost when
> the free trial ended (SLS-68); this file is now the canonical copy.
> Source: `confluence-kb.json` export of 2026-08-19, page version 1.

> **Narrative KB page — added 2026-07-11 (SLS-75).** Our own summary of the reward-shaping lessons from the M6 RL work. Canonical log: `docs/rl-reward.md` in the repo; design rationale in [ADR-014](https://github.com/DionisMuzenitov/starship-catch-sim/blob/main/docs/adr/014-ppo-training-pipeline.md); Jira thread SLS-29. Companion page: [Learning-based booster control: what worked](learning-based-booster-control-what-worked.md).

### The one-line lesson

For the booster-catch environment, **reward design**_**was**_**the failure mode** — not network capacity, not exploration, not compute. The SLS-29 ticket predicted "reward design is _the_ failure mode," and it was proven right **six separate times** in a single session: each fix revealed the next exploit underneath.

### The six exploits (each found, then fixed, via checkpoint diagnostics)

1. **Flat terminals.** Terminal rewards that didn't discriminate near-misses from catches gave the policy no gradient toward the last few metres.
2. **Shaping scale.** Dense shaping terms scaled large enough to dominate the sparse catch bonus — the policy optimized the shaping proxy instead of the actual catch.
3. **The ballistic-800 m curriculum trap.** A curriculum stage starting the booster low enough that a purely ballistic (no-burn) arc scored acceptably — the policy learned to do nothing and coast.
4. **Discount-procrastination — twice.** With &gamma; = 0.99 _and_ again with &gamma; = 0.999, discounting made a **delayed** failure terminal cheaper than an **earlier** costly correction, so the optimal policy was to procrastinate the crash. Fixed only by going to **&gamma; = 1.0 (undiscounted)** — appropriate here because episodes are finite-horizon and every trajectory terminates.
5. **Born-at-50 %-throttle action decode.** The action→throttle mapping meant a zero action decoded to ~50 % throttle, so an untrained/lazy policy hovered by default and never learned deliberate thrust control.
6. **|v_y|-shaping paying for ascent.** A vertical-speed shaping term rewarding low |v_y| inadvertently paid the policy to _ascend_ (also low |v_y| near apex), rewarding exactly the wrong behaviour.

### Why &gamma; = 1.0 is the right call here

Discounting exists to keep infinite-horizon returns finite and to express genuine time-preference. The catch task has **neither** need: episodes are strictly finite (the booster lands, catches, or crashes within seconds) and there is no reason to prefer an earlier catch to a later one _except_ success. Any &gamma; < 1 injects an artificial preference that, combined with a costly-correction-vs-cheap-delay structure, rewards procrastination. Undiscounted returns removed that pathology outright.

### The process lesson (for the fleet log)

**Smoke runs (~150 k steps) were excellent at catching catastrophic reward exploits and useless for confirming convergence.** Every one of the six above was visible within a short smoke run by inspecting checkpoint trajectories; none of them told us whether a _good_ policy would eventually emerge. That split is why SLS-51 was scoped as a systematic overnight campaign ("not same-day whack-a-mole") rather than more smoke iterations.

### Sources

- `docs/rl-reward.md` — the running reward-design log (primary record).
- [ADR-014](https://github.com/DionisMuzenitov/starship-catch-sim/blob/main/docs/adr/014-ppo-training-pipeline.md) — PPO pipeline, curriculum, DR, and the reward rationale.
- Jira: SLS-29 (PPO pipeline + the six-exploit session), SLS-51 (campaign scoping).
