# ADR-015: Attitude inner loop, cascade teacher & the BC-warm-start campaign

- **Status:** Accepted
- **Date:** 2026-07-08
- **Tickets:** SLS-51 (training campaign); follows ADR-014's run-1 verdict
- **Relates to:** SLS-30 (changes the exportable action contract)

## Context

SLS-29's run 1 (PPO, 8-dim action, 2M steps) settled into a stable
non-catching optimum. The diagnosis: *first-catch discovery* through the
non-minimum-phase gimbal→torque→attitude→thrust-direction cascade is the
wall — pure gradient exploration does not find it at laptop budgets.

## Decisions

**1. Attitude inner loop in the env** (`attitude_inner_loop=True`): the
policy commands `[thr_centre, thr_inner, lean_x, lean_z]` (4-dim); an
embedded PD (gains from a step-response sweep: K_ATT=4, K_RATE=8 — the
initial 8/4 overshot 46 % and oscillated against the gimbal actuator lag)
converts lean-target error + body rates to gimbal commands **per physics
substep** (250 Hz). This mirrors real GNC layering (guidance commands
attitude targets; a fast inner loop flies them) and deletes the hardest
learning sub-problem. Fins stay neutral in v1 — negligible authority at
corridor airspeeds; revisit for the high-altitude stages.
**Frame bug caught during tuning:** the first implementation mixed
world-frame lean errors with body-frame rates/actuators — correct at zero
roll, silently divergent as roll drifts (nothing controls roll), observed
as a slow sideways drift into the tower at box height. The error is now
rotated into the body frame first.

**2. Formalised cascade teacher** (`rl.cascade`): two-phase vertical
throttle (kinetic-energy-triggered 13-engine brake → centre-only descent
PD with **mass feed-forward** — a constant hover throttle drifts as fuel
burns and parked the vehicle above the capture box), lateral position PD →
lean targets with a **predictive anti-truss wall** (the catch point sits
2.5 m from the tower face; the teacher aims 2 m off-centre and pushes away
when momentum projects into the keep-out). Corridor starts are mirrored to
the catch side of the tower (a far-side start forces a path through the
truss). Result: **hover 6/6 caught, dock 4/6, approach 1/6** — the first
catches ever achieved in this env, and the existence proof the BC warm
start rests on.

**3. BC warm start** (`scripts/bc_pretrain.py`): clone the teacher's
(obs → action) map into the SB3 policy (MSE on the action mean) and fit
the value head to undiscounted return-to-go (run 1 spent >1M steps
learning "doom follows wandering" from scratch). Weights-only transfer
into a fresh training run (`train_ppo.py --warm-start`).

**4. Campaign orchestrator** (`scripts/campaign.py` + plan YAMLs): runs a
night's queue sequentially — per run: optional BC pretrain → training
hard-capped by wall-clock (SIGINT so periodic checkpoints survive) → eval →
learning-curve PNG → cumulative `summary.json`. A crashed run is recorded
and skipped, never ending the night. Night 1 (owner-approved): A = PPO +
inner loop + BC (4 h), B = same without BC (2 h, ablation), C = SAC +
inner loop (2 h, off-policy alternative).

## Consequences

- **SLS-30 contract:** a policy trained with the inner loop exports a
  4-dim action head, and the browser runtime must implement the same PD
  (gains + LEAN_MAX are in `manifest.json`; the PD is ~15 lines of TS).
  If night-1's winner is an inner-loop run, SLS-30 inherits this.
- The teacher reads true world state (legitimate for a teacher); the
  student clones it from noisy/normalized observations only.
- Campaign state (checkpoints, TB logs, summaries) stays local/gitignored;
  results are posted to the ticket.

## Alternatives considered

- **More budget on the run-1 recipe** — rejected: 1.4M steps of flat tail
  is direct evidence (kept as ablation via run B's no-BC arm).
- **DAgger / iterative imitation** — stronger than one-shot BC but needs
  teacher-in-the-loop infrastructure; BC + PPO fine-tuning is the standard
  first rung. Escalate only if night 1 fails.
- **Roll control via differential gimbal** — real boosters do this; out of
  scope until roll drift is shown to matter beyond the body-frame fix.
