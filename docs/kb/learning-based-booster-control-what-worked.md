# Learning-based booster control: what worked

> Migrated from the Confluence SLS space (SLS-118). Confluence was lost when
> the free trial ended (SLS-68); this file is now the canonical copy.
> Source: `confluence-kb.json` export of 2026-08-19, page version 1.

> **Narrative KB page — added 2026-07-11 (SLS-75).** Our own summary of the M6 learning-based-control phase. Canonical technical records live in the repo: `docs/adr/013–016`, `docs/rl-reward.md`, `services/rl/README.md`, and the [controller comparison report](https://github.com/DionisMuzenitov/starship-catch-sim/blob/main/eval/reports/v1-controller-comparison.md). Jira threads: SLS-28/29/30/51.

### The headline

The shipped M6 controller is an **imitation-learned neural policy** that catches the Super Heavy booster **87 % / 87 % / 90 %** of the time (calm / standard / stormy wind, 30 seeded Monte-Carlo runs per cell) — versus **~50 %** for the convex-MPC baseline and **0 %** for cascaded PID. It runs a dependency-free pure-TypeScript forward pass in the browser.

### The honest arc: direct RL did not work

The milestone was scoped as reinforcement learning, and direct RL **failed to produce a catching policy at laptop compute**:

- **PPO** across three configurations (curriculum + domain randomization + gSDE) — no policy that caught.
- **SAC** with demonstration seeding — same outcome.

The failure trail is documented on SLS-29/51 and in `docs/rl-reward.md`. It is kept, not hidden — it is part of the project's engineering-judgment story.

### What actually worked: two structural moves

1. **An attitude inner loop.** The single biggest unlock (SLS-51 / [ADR-015](https://github.com/DionisMuzenitov/starship-catch-sim/blob/main/docs/adr/015-attitude-inner-loop-and-bc-campaign.md)) was giving the policy a **250 Hz body-frame attitude-PD inner loop** to command, instead of raw gimbal angles. The learned policy outputs high-level thrust + lean targets at 25 Hz; the fast PD absorbs attitude disturbances. This is the same guidance/control layering real boosters use, and it turned "zero catches" into the first catches the project ever recorded.
2. **Imitation learning instead of RL.** Rather than discover a policy from reward, we **behaviour-cloned a scripted cascade teacher** (a suicide-burn ignition law + saturated-P guidance) on ~1 700 success-filtered, coast-subsampled demonstrations. The winning checkpoint is `clone7_bc`.

### The shipped artifact

- **Architecture:** a 17 → 256 → 256 → 4 `tanh` MLP (578 KB), commanding `[thr_centre, thr_inner, lean_x, lean_z]`.
- **Runtime:** a synchronous pure-TypeScript forward pass from JSON weights — **no ONNX, no WASM** ([ADR-016](https://github.com/DionisMuzenitov/starship-catch-sim/blob/main/docs/adr/016-ts-policy-runtime.md)). Weights live in `apps/web/public/models/booster_policy.json`.
- **Parity:** the numpy (training) and TypeScript (runtime) physics cores are single-sourced and CI-tested to 1e-4 on fixed observations ([ADR-013](https://github.com/DionisMuzenitov/starship-catch-sim/blob/main/docs/adr/013-rl-numpy-port-and-parity.md)).

### Caveats worth stating

- **"RL" is aspirational here.** The shipped policy is imitation-learned; it inherits the teacher's ceiling. Polishing beyond the teacher (true RL fine-tuning) is tracked but unfinished (SLS-53).
- **Stormy generalizes but is not proven.** The policy never trained on the stormy wind profile; the 90 % there is promising, not validated — the inner loop absorbs the disturbance and training DR covered comparable offsets. A dedicated stormy campaign is SLS-54.
- **Single-checkpoint fragility.** `clone7_bc` is weak on mid-corridor starts; a stronger mid-corridor checkpoint exists separately (SLS-52).

### Sources

- Repo ADRs 013 (numpy parity), 014 (PPO pipeline), 015 (attitude loop + BC campaign), 016 (TS runtime).
- `docs/rl-reward.md` (reward-design log), `services/rl/README.md` (experiment lineage).
- Jira: SLS-28 (foundation), SLS-29 (PPO), SLS-51 (campaign), SLS-30 (TS export).
- Bench: `eval/reports/v1-controller-comparison.md`. Reproduce with `pnpm bench:rl`.

_See also: [[Reward design for the catch env]]._
