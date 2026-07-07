"""Behaviour-cloning warm start from the scripted cascade teacher (SLS-51).

Usage:
    uv run python scripts/bc_pretrain.py --config configs/ppo-booster-il.yaml \
        --out checkpoints-bc/bc_warmstart.zip [--episodes 40] [--epochs 60]

Collects (obs, action) demonstrations by rolling `rl.cascade` over the
config's corridor curriculum stages (with the config's DR so the student
sees the training distribution), then supervised-fits the SB3 policy:

- action head: MSE between the policy's deterministic action mean and the
  teacher action;
- value head: MSE against undiscounted return-to-go (a value warm start —
  run 1 showed the value net taking >1M steps to learn "doom follows
  wandering" from scratch).

The output zip is a normal SB3 model; `train_ppo.py --warm-start <zip>`
copies its policy weights into a fresh training run (weights only — no
optimizer state, no timesteps).

The teacher reads the TRUE world state (it is a feedback controller, so it
stays valid under DR); the student learns from the noisy, normalized
observations it will actually receive.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import torch
import yaml
from stable_baselines3 import PPO

from rl.cascade import CascadeParams, rollout_cascade
from rl.curriculum import stages_from_config
from rl.dr import DomainRandomizationWrapper, DRConfig
from rl.env import StarshipCatchEnv


def collect(cfg: dict, episodes_per_stage: int, max_steps: int, seed0: int):
    env_cfg = dict(cfg.get("env", {}))
    dr_raw = dict(cfg.get("dr", {}))
    use_dr = dr_raw.pop("enabled", False)
    stages = stages_from_config(cfg.get("curriculum", {}).get("stages"))
    # teacher works where starts are corridor-like; skip full-scenario stages
    teach_stages = [s for s in stages if s.start_alt_range is not None]

    all_obs, all_act, all_ret = [], [], []
    outcomes: dict[str, int] = {}
    seed = seed0
    for stage in teach_stages:
        for _ in range(episodes_per_stage):
            env = StarshipCatchEnv(
                scenario_id=stage.scenario_id,
                start_alt_range=stage.start_alt_range,
                **env_cfg,
            )
            if use_dr:
                env = DomainRandomizationWrapper(env, DRConfig(**dr_raw))
            obs, act, outcome, _ = rollout_cascade(
                env, seed=seed, max_steps=max_steps, params=CascadeParams()
            )
            seed += 1
            outcomes[outcome] = outcomes.get(outcome, 0) + 1
            # keep every episode: even failures teach descend/approach/upright.
            all_obs.append(obs)
            all_act.append(act)
            # undiscounted return-to-go for the value warm start
            rew = np.zeros(len(obs))
            # re-derive per-step rewards cheaply from potential? Not stored —
            # approximate with terminal-only signal spread by remaining steps.
            terminal = 100.0 if outcome == "caught" else -60.0
            rew[-1] = terminal
            rtg = np.cumsum(rew[::-1])[::-1]
            all_ret.append(rtg)
    return (
        np.concatenate(all_obs),
        np.concatenate(all_act),
        np.concatenate(all_ret),
        outcomes,
    )


def bc_fit(model: PPO, obs, act, ret, epochs: int, batch: int, lr: float,
           value_coef: float = 0.5):
    policy = model.policy
    device = policy.device
    obs_t = torch.as_tensor(obs, dtype=torch.float32, device=device)
    act_t = torch.as_tensor(act, dtype=torch.float32, device=device)
    ret_t = torch.as_tensor(ret, dtype=torch.float32, device=device)
    opt = torch.optim.Adam(policy.parameters(), lr=lr)
    n = len(obs_t)
    policy.set_training_mode(True)
    for ep in range(epochs):
        perm = torch.randperm(n, device=device)
        tot_a = tot_v = 0.0
        for i in range(0, n, batch):
            idx = perm[i : i + batch]
            features = policy.extract_features(obs_t[idx])
            latent_pi, latent_vf = policy.mlp_extractor(features)
            mean_actions = policy.action_net(latent_pi)
            values = policy.value_net(latent_vf).squeeze(-1)
            loss_a = torch.nn.functional.mse_loss(mean_actions, act_t[idx])
            loss_v = torch.nn.functional.mse_loss(values, ret_t[idx])
            loss = loss_a + value_coef * loss_v
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot_a += float(loss_a) * len(idx)
            tot_v += float(loss_v) * len(idx)
        if ep % 10 == 0 or ep == epochs - 1:
            print(f"epoch {ep:3d}  action-mse {tot_a/n:.5f}  value-mse {tot_v/n:.1f}")
    policy.set_training_mode(False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--out", default="checkpoints-bc/bc_warmstart.zip")
    ap.add_argument("--episodes", type=int, default=40, help="per teachable stage")
    ap.add_argument("--max-steps", type=int, default=1500)
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--batch", type=int, default=512)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--seed", type=int, default=7000)
    args = ap.parse_args()

    cfg = yaml.safe_load(Path(args.config).read_text())
    print("collecting demonstrations from the cascade teacher...")
    obs, act, ret, outcomes = collect(cfg, args.episodes, args.max_steps, args.seed)
    print(f"collected {len(obs):,} transitions; teacher outcomes: {outcomes}")

    env_cfg = dict(cfg.get("env", {}))
    ppo_cfg = dict(cfg.get("ppo", {}))
    net_arch = ppo_cfg.pop("net_arch", [256, 256])
    policy_kwargs = {"net_arch": list(net_arch)}
    if "log_std_init" in ppo_cfg:
        policy_kwargs["log_std_init"] = float(ppo_cfg.pop("log_std_init"))
    env = StarshipCatchEnv(**env_cfg)
    model = PPO("MlpPolicy", env, policy_kwargs=policy_kwargs,
                seed=int(cfg.get("seed", 42)), device="cpu", **ppo_cfg)

    print("behaviour cloning...")
    bc_fit(model, obs, act, ret, args.epochs, args.batch, args.lr)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    model.save(out)
    np.savez_compressed(out.with_suffix(".demos.npz"), obs=obs, act=act, ret=ret)
    print(f"saved warm-start checkpoint {out} (+ demos sidecar)")


if __name__ == "__main__":
    main()
