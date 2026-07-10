# services/rl — RL / imitation-learning training lab

Trains the guidance policy that flies the booster catch, ports the physics core
to numpy (parity-checked against the TS core — ADR-013), and exports the winning
checkpoint to the JSON weights the browser ships. This directory is the "how the
policy was made" record; the shipped artifact and its runtime live elsewhere
(see [below](#what-actually-ships)).

## What actually ships

- **Deployed policy:** `apps/web/public/models/booster_policy.json` — a
  17→256→256→4 tanh MLP (self-describing: weights + obs layout + decode
  semantics + inner-loop PD gains + provenance).
- **Made from:** `checkpoints-il/clone7_bc.zip`, via
  `scripts/export_policy.py` (which also emits the TS↔Python parity fixture).
- **How it was trained:** **imitation learning**, not RL. Behaviour cloning on
  ~1,700 successful demonstrations from a scripted-cascade teacher, curated per
  the SLS-51 findings (success-filtered, coast-subsampled, teacher aggressiveness
  matched to student flyability). Direct RL never produced a catching policy at
  laptop compute — see the experiment legend.

## Experiment legend

The `checkpoints-*` dirs are the campaign trail. The lettered ones are the
**direct-RL attempts that failed**; the imitation-first pivot (`checkpoints-il`)
is what worked.

| Dir                                            | Approach                         | Config                          | Outcome                                                  |
| ---------------------------------------------- | -------------------------------- | ------------------------------- | -------------------------------------------------------- |
| `checkpoints-A-ppo-il-bc`                      | PPO warm-started from a BC clone | `configs/ppo-booster-il.yaml`   | BC erased by on-policy updates (clone −36 → −86 by 100k) |
| `checkpoints-A2-ppo-il-bc-kl`                  | A + `target_kl` trust region     | `configs/campaign-night1*.yaml` | `target_kl` didn't save it (mis-scaled value net)        |
| `checkpoints-B-ppo-il`                         | PPO, IL-shaped reward            | `configs/ppo-booster.yaml`      | no catches                                               |
| `checkpoints-C2-sac-il-demos`                  | SAC + demo-buffer seeding        | `configs/sac-booster-il.yaml`   | 6.8M steps flat                                          |
| **`checkpoints-il`**                           | **BC + one DAgger iteration**    | via `scripts/il_train.py`       | **the winning lineage — see below**                      |
| `checkpoints-smoke`, `-vnsmoke`, `checkpoints` | smoke / scratch runs             | `*-smoke.yaml`                  | throwaway                                                |

Winning lineage inside `checkpoints-il/`:

- **`clone7_bc.zip`** — the **shipped** policy. Full-calm 8/8, full-standard 7/8
  clean on the numpy env (at/above the MPC bench). BC only; DAgger _damaged_ this
  strong base, so it was not used (SLS-51 lesson: gate DAgger on BC quality).
- **`clone3_dagger1.zip`** — complementary: 81% on DR corridor starts, weak on
  fulls. Merging the two capabilities is SLS-52.

## Reproduce the shipped policy

```bash
# from repo root; needs uv + the train dependency group
pnpm rl:train            # (optional) direct PPO — reproduces the failure, not the policy
cd services/rl
uv run python scripts/collect_demos.py   # scripted-cascade teacher → demos*/  (seeded)
uv run python scripts/il_train.py        # BC (+ optional DAgger) → checkpoints-il/
uv run python scripts/export_policy.py \
    --checkpoint checkpoints-il/clone7_bc.zip \
    --out ../../apps/web/public/models/booster_policy.json \
    --fixture ../../packages/controllers/src/__fixtures__/rl_policy_parity.json
```

The reward/shaping design and the full failure-mode postmortem are in
[`docs/rl-reward.md`](../../docs/rl-reward.md); the design decisions are ADR-013
(numpy port + parity), ADR-014 (PPO pipeline), ADR-015 (attitude inner loop + BC
campaign), ADR-016 (TS runtime).

## Tracked vs local

Everything heavy is **gitignored and lives only on the training machine**:
`checkpoints*/`, `runs/` (TensorBoard), `demos*/` (datasets). They are
regenerable — demos from the seeded teacher, checkpoints from the demos. The
winning checkpoint and the M6 gate records are attached to the **v0.6.0 GitHub
Release** for durability (SLS-67). Only `booster_policy.json` (the exported
weights) is committed, under `apps/web/public/models/`.
