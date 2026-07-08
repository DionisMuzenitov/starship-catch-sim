"""Evaluate a trained PPO checkpoint on the booster scenarios (SLS-29).

Usage:
    uv run python scripts/eval_policy.py --checkpoint checkpoints/latest.zip \
        [--episodes 100] [--scenarios booster-descent-calm,...] [--n-envs 6]

Deterministic policy, nominal plant (no DR), real scenario wind, full-descent
starts — i.e. the same conditions as the TS bench. Reports success rate,
outcome histogram, fuel + terminal stats per scenario; writes
eval/results/rl-<timestamp>.json.

Reference points (recorded on the TS bench, `pnpm bench:mpc --seeds 30`,
SLS-47/ADR-010): MPC+plan 53/50/50 % catch on Calm/Standard/Stormy. The
like-for-like RL-vs-MPC comparison on the SAME TS bench is SLS-30's
deliverable — numbers here are from the parity-proven numpy plant.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from stable_baselines3 import PPO, SAC
from stable_baselines3.common.vec_env import SubprocVecEnv, VecMonitor

from rl.env import StarshipCatchEnv

DEFAULT_SCENARIOS = (
    "booster-descent-calm",
    "booster-descent-standard",
    "booster-descent-stormy",
)


def make_thunk(scenario_id: str, env_cfg: dict):
    def _thunk():
        return StarshipCatchEnv(scenario_id=scenario_id, **env_cfg)

    return _thunk


def eval_scenario(model, scenario_id: str, episodes: int, n_envs: int, env_cfg: dict):
    venv = VecMonitor(
        SubprocVecEnv([make_thunk(scenario_id, env_cfg) for _ in range(n_envs)])
    )
    try:
        venv.seed(2000)
        obs = venv.reset()
        outcomes: list[str] = []
        fuels: list[float] = []
        returns: list[float] = []
        acc = np.zeros(venv.num_envs)
        while len(outcomes) < episodes:
            actions, _ = model.predict(obs, deterministic=True)
            obs, rewards, dones, infos = venv.step(actions)
            acc += rewards
            for i, d in enumerate(dones):
                if d:
                    outcomes.append(infos[i].get("outcome", "none"))
                    fuels.append(float(infos[i].get("fuel", 0.0)))
                    returns.append(float(acc[i]))
                    acc[i] = 0.0
    finally:
        venv.close()

    hist: dict[str, int] = {}
    for o in outcomes:
        hist[o] = hist.get(o, 0) + 1
    catches = hist.get("caught", 0)
    return {
        "scenario": scenario_id,
        "episodes": len(outcomes),
        "success_rate": catches / len(outcomes),
        "outcomes": hist,
        "mean_return": float(np.mean(returns)),
        "mean_fuel_remaining_kg": float(np.mean(fuels)),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--episodes", type=int, default=100)
    ap.add_argument("--n-envs", type=int, default=6)
    ap.add_argument("--scenarios", default=",".join(DEFAULT_SCENARIOS))
    ap.add_argument("--frame-skip", type=int, default=10)
    args = ap.parse_args()

    ckpt = Path(args.checkpoint)
    manifest_path = ckpt.parent / "manifest.json"
    env_cfg = {
        "frame_skip": args.frame_skip,
        "booster_landing_action": True,
        "normalize_obs": True,
        "gamma": 0.99,
    }
    if manifest_path.exists():
        m = json.loads(manifest_path.read_text())
        env_cfg["booster_landing_action"] = m.get("booster_landing_action", True)
        env_cfg["normalize_obs"] = m.get("normalize_obs", True)
        env_cfg["frame_skip"] = m.get("frame_skip", args.frame_skip)
        env_cfg["gamma"] = m.get("gamma", 0.99)

    try:
        model = PPO.load(ckpt, device="cpu")
    except (TypeError, KeyError, ValueError):
        model = SAC.load(ckpt, device="cpu")  # SAC checkpoint (SLS-51)
    results = []
    for sid in args.scenarios.split(","):
        t0 = time.time()
        r = eval_scenario(model, sid.strip(), args.episodes, args.n_envs, env_cfg)
        r["wall_s"] = round(time.time() - t0, 1)
        results.append(r)
        print(
            f"{r['scenario']:32s} success {r['success_rate']:6.1%}  "
            f"outcomes {r['outcomes']}  fuel {r['mean_fuel_remaining_kg']:.0f} kg  "
            f"({r['wall_s']}s)"
        )

    print("\nreference (TS bench, MPC+plan, 30 seeds): calm 53% / standard 50% / stormy 50%")
    print("like-for-like RL-vs-MPC on the TS bench lands with SLS-30.")

    out_dir = Path("eval/results")
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"rl-{time.strftime('%Y%m%d-%H%M%S')}.json"
    out.write_text(
        json.dumps(
            {"checkpoint": str(ckpt), "episodes": args.episodes, "results": results},
            indent=2,
        )
    )
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
