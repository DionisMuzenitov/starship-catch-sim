"""Imitation-learning trainer: BC on teacher transitions + DAgger loop (SLS-51).

Usage:
    uv run python scripts/il_train.py --config configs/ppo-booster-il.yaml \
        --demos "demos/batch_*.npz" --out checkpoints-il/clone.zip \
        [--epochs 80] [--dagger-iters 2] [--dagger-episodes 60]

1. Merge demo batches, behaviour-clone the policy (rl.bc.bc_fit).
2. DAgger iterations: roll the CLONE in DR training envs, label every
   visited state with the TEACHER's action, aggregate, refit. This closes
   the compounding-error gap — plain BC only sees the teacher's own states,
   so the clone drifts off-distribution and doesn't know the way back.
3. Save an SB3-PPO-format checkpoint (usable directly for eval, ONNX export
   in SLS-30, or --warm-start for the RL polish phase).
"""

from __future__ import annotations

import argparse
import glob
import json
from pathlib import Path

import numpy as np
import yaml
from stable_baselines3 import PPO

from rl.bc import bc_fit, returns_to_go
from rl.cascade import CascadeParams, cascade_action
from rl.curriculum import stages_from_config
from rl.dr import DomainRandomizationWrapper, DRConfig
from rl.env import StarshipCatchEnv


def load_demos(pattern: str, successes_only: bool = False,
               subsample_coast: bool = False):
    files = sorted(glob.glob(pattern))
    if not files:
        raise SystemExit(f"no demo files match {pattern}")
    OBS, ACT, RET = [], [], []
    kept = dropped = 0
    for f in files:
        d = np.load(f)
        obs_f, act_f, rew_f, ep_f = d["obs"], d["act"], d["rew"], d["ep"]
        if successes_only:
            # Keep only episodes ending in a catch (terminal reward ≈ +100;
            # graded failures are ≤ -40). The v3 demo set's 28 % of episodes
            # END in tower collisions from otherwise-good approaches —
            # cloning those trajectories teaches flying INTO the truss
            # (round-4 BC eval collapsed to 3/48).
            mask = np.zeros(len(ep_f), dtype=bool)
            boundaries = np.flatnonzero(np.diff(ep_f)) + 1
            starts = np.concatenate([[0], boundaries])
            ends = np.concatenate([boundaries, [len(ep_f)]])
            for st, en in zip(starts, ends):
                ok = rew_f[en - 1] > 50.0
                mask[st:en] = ok
                kept += int(ok)
                dropped += int(not ok)
            obs_f, act_f, rew_f, ep_f = (
                obs_f[mask], act_f[mask], rew_f[mask], ep_f[mask]
            )
        OBS.append(obs_f)
        ACT.append(act_f)
        RET.append(returns_to_go(rew_f, ep_f))
    if subsample_coast:
        obs_all = np.concatenate(OBS)
        act_all = np.concatenate(ACT)
        ret_all = np.concatenate(RET)
        # Coast transitions (high altitude, constant attitude-authority
        # throttle) are ~55 % of full-descent episodes and teach a constant
        # action — they drown the terminal-phase data (round-5 finding:
        # full-descent demos diluted corridor cloning 6x). Keep 1-in-8.
        alt_above = obs_all[:, 1] * 70_000.0 - 91.0  # normalized obs -> metres
        coast = (
            (alt_above > 2_000.0)
            & (np.abs(act_all[:, 0] - 0.45) < 0.05)
            & (act_all[:, 1] <= 0.02)
        )
        keep = ~coast | (np.arange(len(coast)) % 8 == 0)
        n0 = len(obs_all)
        obs_all, act_all, ret_all = obs_all[keep], act_all[keep], ret_all[keep]
        print(f"coast subsample: {n0:,} -> {len(obs_all):,} transitions")
        return obs_all, act_all, ret_all
    obs = np.concatenate(OBS)
    act = np.concatenate(ACT)
    ret = np.concatenate(RET)
    extra = f" (successes only: kept {kept} eps, dropped {dropped})" if successes_only else ""
    print(f"loaded {len(obs):,} transitions from {len(files)} files{extra}")
    return obs, act, ret


def make_env(cfg: dict, stage, use_dr: bool):
    env_cfg = dict(cfg.get("env", {}))
    dr_raw = dict(cfg.get("dr", {}))
    dr_raw.pop("enabled", None)
    env = StarshipCatchEnv(
        scenario_id=stage.scenario_id, start_alt_range=stage.start_alt_range,
        **env_cfg,
    )
    if use_dr:
        env = DomainRandomizationWrapper(env, DRConfig(**dr_raw))
    return env


def dagger_collect(model, cfg, stages, episodes_per_stage, max_steps, seed0,
                   weights: dict | None = None):
    """Roll the clone; label visited states with the teacher. `weights`
    multiplies episodes for named stages (wind-descent emphasis)."""
    p = CascadeParams(pos_kp=0.06, vel_kd=0.40, lean_cmd_max=1.0, acc_max=4.0)
    OBS, ACT = [], []
    outcomes: dict[str, int] = {}
    seed = seed0
    for stage in stages:
        mult = (weights or {}).get(stage.name, 1)
        for _ in range(episodes_per_stage * mult):
            env = make_env(cfg, stage, use_dr=True)
            obs, _ = env.reset(seed=seed)
            seed += 1
            for _ in range(max_steps):
                teacher_a = cascade_action(env, p)
                OBS.append(np.asarray(obs, dtype=np.float32))
                ACT.append(teacher_a.astype(np.float32))
                a, _ = model.predict(obs, deterministic=True)  # CLONE acts
                obs, _, term, trunc, info = env.step(a)
                if term or trunc:
                    o = info.get("outcome", "none")
                    outcomes[o] = outcomes.get(o, 0) + 1
                    break
    return np.array(OBS), np.array(ACT), outcomes


def evaluate(model, cfg, stages, n=8, seed0=5000, use_dr=False):
    results = {}
    for stage in stages:
        outs = []
        for s in range(n):
            env = make_env(cfg, stage, use_dr=use_dr)
            obs, _ = env.reset(seed=seed0 + s)
            info = {}
            for _ in range(6000):
                a, _ = model.predict(obs, deterministic=True)
                obs, _, term, trunc, info = env.step(a)
                if term or trunc:
                    break
            outs.append(info.get("outcome", "none"))
        results[stage.name] = {
            "caught": outs.count("caught"), "n": n,
            "outcomes": {o: outs.count(o) for o in set(outs)},
        }
        print(f"  {stage.name:14s} {results[stage.name]['caught']}/{n}  "
              f"{results[stage.name]['outcomes']}", flush=True)
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--demos", required=True, help="glob of transition npz files")
    ap.add_argument("--out", default="checkpoints-il/clone.zip")
    ap.add_argument("--epochs", type=int, default=80)
    ap.add_argument("--dagger-iters", type=int, default=2)
    ap.add_argument("--dagger-episodes", type=int, default=60, help="per stage per iter")
    ap.add_argument("--dagger-epochs", type=int, default=40)
    ap.add_argument("--batch", type=int, default=1024)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--max-steps", type=int, default=4000)
    ap.add_argument("--successes-only", action="store_true",
                    help="BC only on episodes that ended in a catch")
    ap.add_argument("--subsample-coast", action="store_true",
                    help="keep 1-in-8 constant-action coast transitions")
    ap.add_argument("--dagger-weights", default=None,
                    help="stage episode multipliers, e.g. full-standard=3,full-calm=2")
    args = ap.parse_args()

    cfg = yaml.safe_load(Path(args.config).read_text())
    stages = [
        s for s in stages_from_config(cfg.get("curriculum", {}).get("stages"))
        if s.start_alt_range is not None or not s.name.endswith("stormy")
    ]

    obs, act, ret = load_demos(args.demos, successes_only=args.successes_only,
                               subsample_coast=args.subsample_coast)

    env_cfg = dict(cfg.get("env", {}))
    ppo_cfg = dict(cfg.get("ppo", {}))
    net_arch = ppo_cfg.pop("net_arch", [256, 256])
    policy_kwargs = {"net_arch": list(net_arch)}
    if "log_std_init" in ppo_cfg:
        policy_kwargs["log_std_init"] = float(ppo_cfg.pop("log_std_init"))
    model = PPO("MlpPolicy", StarshipCatchEnv(**env_cfg),
                policy_kwargs=policy_kwargs, seed=int(cfg.get("seed", 42)),
                device="cpu", **ppo_cfg)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    print("== BC fit ==")
    bc_fit(model, obs, act, ret, args.epochs, args.batch, args.lr)
    model.save(out.with_stem(out.stem + "_bc"))
    print("== eval after BC (clean) ==")
    report = {"bc": evaluate(model, cfg, stages)}

    all_obs, all_act, all_ret = [obs], [act], [ret]
    for it in range(args.dagger_iters):
        print(f"== DAgger iter {it + 1}: clone rollouts + teacher labels ==")
        weights = None
        if args.dagger_weights:
            weights = {
                kv.split("=")[0]: int(kv.split("=")[1])
                for kv in args.dagger_weights.split(",")
            }
        d_obs, d_act, d_out = dagger_collect(
            model, cfg, stages, args.dagger_episodes, args.max_steps,
            seed0=40000 + it * 10000, weights=weights,
        )
        print(f"  collected {len(d_obs):,} labelled states; clone outcomes {d_out}")
        all_obs.append(d_obs)
        all_act.append(d_act)
        all_ret.append(np.zeros(len(d_obs)))  # rtg unknown for clone states
        obs_a = np.concatenate(all_obs)
        act_a = np.concatenate(all_act)
        ret_a = np.concatenate(all_ret)
        # value_coef=0 on aggregate refits: the appended returns are dummies.
        bc_fit(model, obs_a, act_a, ret_a, args.dagger_epochs, args.batch,
               args.lr * 0.5, value_coef=0.0)
        model.save(out.with_stem(out.stem + f"_dagger{it + 1}"))
        print(f"== eval after DAgger {it + 1} (clean) ==")
        report[f"dagger{it + 1}"] = evaluate(model, cfg, stages)

    print("== final eval under DR ==")
    report["final_dr"] = evaluate(model, cfg, stages, use_dr=True, seed0=6000)

    model.save(out)
    out.with_suffix(".report.json").write_text(json.dumps(report, indent=2))
    print(f"saved {out} + report")


if __name__ == "__main__":
    main()
