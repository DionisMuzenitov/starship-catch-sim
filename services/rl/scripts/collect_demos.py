"""Collect FULL teacher transitions (s, a, r, s', done) for off-policy demo
seeding (SLS-51 night-1: SAC replay-buffer warm start).

Usage:
    uv run python scripts/collect_demos.py --config configs/ppo-booster-il.yaml \
        --out demos/teacher_transitions.npz [--episodes 20]

Unlike bc_pretrain's (obs, action) pairs, off-policy replay needs rewards and
next-observations, and the reward must be the RAW env reward (the run that
consumes these must train with `normalize_reward: false`, or buffer rewards
and env rewards live on different scales — the exact class of mismatch that
killed the PPO warm start).
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import yaml

from rl.cascade import CascadeParams, cascade_action
from rl.curriculum import stages_from_config
from rl.dr import DomainRandomizationWrapper, DRConfig
from rl.env import StarshipCatchEnv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--out", default="demos/teacher_transitions.npz")
    ap.add_argument("--episodes", type=int, default=20, help="per teachable stage")
    ap.add_argument("--max-steps", type=int, default=1500)
    ap.add_argument("--seed", type=int, default=9000)
    args = ap.parse_args()

    cfg = yaml.safe_load(Path(args.config).read_text())
    env_cfg = dict(cfg.get("env", {}))
    dr_raw = dict(cfg.get("dr", {}))
    use_dr = dr_raw.pop("enabled", False)
    stages = stages_from_config(cfg.get("curriculum", {}).get("stages"))
    teach_stages = [s for s in stages if s.start_alt_range is not None]

    OBS, ACT, REW, NOBS, DONE, EP = [], [], [], [], [], []
    outcomes: dict[str, int] = {}
    seed = args.seed
    ep_id = 0
    p = CascadeParams()
    for stage in teach_stages:
        for _ in range(args.episodes):
            env = StarshipCatchEnv(
                scenario_id=stage.scenario_id,
                start_alt_range=stage.start_alt_range,
                **env_cfg,
            )
            if use_dr:
                env = DomainRandomizationWrapper(env, DRConfig(**dr_raw))
            obs, _ = env.reset(seed=seed)
            seed += 1
            ep_id += 1
            for _ in range(args.max_steps):
                a = cascade_action(env, p)
                nobs, r, term, trunc, info = env.step(a)
                OBS.append(obs)
                ACT.append(a)
                REW.append(r)
                NOBS.append(nobs)
                # truncation is not a Markov terminal: done=False keeps the
                # bootstrap alive for timeout episodes.
                DONE.append(bool(term))
                EP.append(ep_id)
                obs = nobs
                if term or trunc:
                    outcomes[info.get("outcome", "none")] = (
                        outcomes.get(info.get("outcome", "none"), 0) + 1
                    )
                    break

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        out,
        obs=np.asarray(OBS, dtype=np.float32),
        act=np.asarray(ACT, dtype=np.float32),
        rew=np.asarray(REW, dtype=np.float32),
        next_obs=np.asarray(NOBS, dtype=np.float32),
        done=np.asarray(DONE, dtype=np.float32),
        ep=np.asarray(EP, dtype=np.int64),
    )
    print(f"saved {len(OBS):,} transitions -> {out}; teacher outcomes: {outcomes}")


if __name__ == "__main__":
    main()
