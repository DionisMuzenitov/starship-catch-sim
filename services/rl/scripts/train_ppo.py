"""PPO/SAC training for the booster catch (SLS-29, SLS-51).

Usage:
    uv run python scripts/train_ppo.py --config configs/ppo-booster.yaml
    uv run python scripts/train_ppo.py --config ... --resume-from checkpoints/latest.zip

Pipeline: SubprocVecEnv(n) of DR-wrapped StarshipCatchEnv → VecMonitor →
VecNormalize (reward only; obs use the env's FIXED scales so the ONNX export
in SLS-30 needs no runtime statistics) → SB3 PPO (MlpPolicy) → TensorBoard.

A curriculum callback evaluates every `eval.freq_steps` on the CURRENT stage
(deterministic, DR off, scenario wind on) and promotes all workers through
(start-altitude band × wind scenario) stages when success clears the bar —
see rl.curriculum. Checkpoints + VecNormalize stats + curriculum state are
saved every `checkpoint.freq_steps` and on best-eval; `latest.zip` always
points at the newest.
"""

from __future__ import annotations

import argparse
import json
import shutil
import time
from pathlib import Path

import numpy as np
import yaml
from stable_baselines3 import PPO, SAC
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.vec_env import (
    SubprocVecEnv,
    VecMonitor,
    VecNormalize,
)

from rl.curriculum import CurriculumManager, stages_from_config
from rl.dr import DomainRandomizationWrapper, DRConfig
from rl.env import StarshipCatchEnv


def make_worker(env_cfg: dict, dr_cfg: dict | None, stage):
    """Picklable thunk for SubprocVecEnv (cloudpickle handles the closure)."""

    def _thunk():
        env = StarshipCatchEnv(
            scenario_id=stage.scenario_id,
            start_alt_range=stage.start_alt_range,
            **env_cfg,
        )
        if dr_cfg is not None:
            env = DomainRandomizationWrapper(env, DRConfig(**dr_cfg))
        return env

    return _thunk


def make_eval_env(env_cfg: dict, stage, n_envs: int):
    """Eval env: nominal plant (no DR), scenario wind, current-stage starts."""
    return VecMonitor(
        SubprocVecEnv(
            [make_worker(env_cfg, None, stage) for _ in range(n_envs)]
        )
    )


def eval_success(model, venv, n_episodes: int, seed: int = 1000) -> dict:
    """Deterministic policy rollouts; success = info['outcome'] == 'caught'."""
    venv.seed(seed)
    obs = venv.reset()
    done_count = 0
    successes = 0
    returns = []
    acc = np.zeros(venv.num_envs)
    while done_count < n_episodes:
        actions, _ = model.predict(obs, deterministic=True)
        obs, rewards, dones, infos = venv.step(actions)
        acc += rewards
        for i, d in enumerate(dones):
            if d:
                done_count += 1
                successes += bool(infos[i].get("outcome") == "caught")
                returns.append(float(acc[i]))
                acc[i] = 0.0
    return {
        "success_rate": successes / max(done_count, 1),
        "episodes": done_count,
        "mean_return": float(np.mean(returns)) if returns else 0.0,
    }


class CurriculumEvalCallback(BaseCallback):
    def __init__(
        self,
        manager: CurriculumManager,
        env_cfg: dict,
        eval_cfg: dict,
        ckpt_dir: Path,
        verbose: int = 1,
    ):
        super().__init__(verbose)
        self.manager = manager
        self.env_cfg = env_cfg
        self.eval_freq = int(eval_cfg.get("freq_steps", 100_000))
        self.n_episodes = int(eval_cfg.get("n_episodes", 24))
        self.n_eval_envs = int(eval_cfg.get("n_envs", 4))
        self.ckpt_dir = ckpt_dir
        self.best = -1.0
        self._eval_env = None
        self._next_eval = self.eval_freq

    def _rebuild_eval_env(self):
        if self._eval_env is not None:
            self._eval_env.close()
        self._eval_env = make_eval_env(
            self.env_cfg, self.manager.stage, self.n_eval_envs
        )

    def _on_training_start(self) -> None:
        self._rebuild_eval_env()

    def _on_step(self) -> bool:
        if self.num_timesteps < self._next_eval:
            return True
        self._next_eval += self.eval_freq

        t0 = time.time()
        stats = eval_success(self.model, self._eval_env, self.n_episodes)
        sr = stats["success_rate"]
        stage = self.manager.stage
        self.logger.record("eval/success_rate", sr)
        self.logger.record("eval/mean_return", stats["mean_return"])
        self.logger.record("eval/stage_index", self.manager.index)
        if self.verbose:
            print(
                f"[eval @ {self.num_timesteps:,}] stage={stage.name} "
                f"success={sr:.0%} return={stats['mean_return']:.1f} "
                f"({time.time() - t0:.0f}s)"
            )

        if sr > self.best:
            self.best = sr
            self.model.save(self.ckpt_dir / "best.zip")

        if self.manager.update(sr):
            new = self.manager.stage
            print(f"[curriculum] PROMOTED -> {new.name}")
            self.training_env.env_method(
                "set_stage",
                scenario_id=new.scenario_id,
                start_alt_range=new.start_alt_range,
            )
            self._rebuild_eval_env()
            self.best = -1.0  # fresh bar for the new stage
        (self.ckpt_dir / "curriculum.json").write_text(
            json.dumps({"stage_index": self.manager.index, "stage": stage.name})
        )
        return True

    def _on_training_end(self) -> None:
        if self._eval_env is not None:
            self._eval_env.close()


class CheckpointCallback(BaseCallback):
    def __init__(self, freq_steps: int, ckpt_dir: Path, run_name: str):
        super().__init__()
        self.freq = int(freq_steps)
        self.ckpt_dir = ckpt_dir
        self.run_name = run_name
        self._next = self.freq

    def _save(self, path: Path):
        self.model.save(path)
        venv = self.model.get_env()
        if isinstance(venv, VecNormalize):
            venv.save(str(self.ckpt_dir / "vecnormalize.pkl"))
        shutil.copyfile(path, self.ckpt_dir / "latest.zip")

    def _on_step(self) -> bool:
        if self.num_timesteps >= self._next:
            self._next += self.freq
            self._save(self.ckpt_dir / f"{self.run_name}_{self.num_timesteps}.zip")
        return True

    def _on_training_end(self) -> None:
        self._save(self.ckpt_dir / f"{self.run_name}_final.zip")


def main():
    # A nohup/background launch chain leaves SIGINT at SIG_IGN (POSIX) and
    # Python inherits it — the campaign's wall-clock SIGINT then does
    # nothing and the run gets SIGKILLed without saving (SLS-51 dry-run
    # finding). Restore the default handler explicitly.
    import signal

    signal.signal(signal.SIGINT, signal.default_int_handler)

    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--total-timesteps", type=int, default=None)
    ap.add_argument("--n-envs", type=int, default=None)
    ap.add_argument("--device", default=None)
    ap.add_argument("--resume-from", default=None)
    ap.add_argument(
        "--demo-buffer",
        default=None,
        help="npz of teacher transitions (obs, act, rew, next_obs, done) to "
        "seed an off-policy (SAC) replay buffer; requires "
        "normalize_reward: false so demo and env rewards share a scale",
    )
    ap.add_argument(
        "--warm-start",
        default=None,
        help="checkpoint to copy POLICY WEIGHTS from (e.g. a BC pretrain zip); "
        "fresh optimizer/timesteps, unlike --resume-from",
    )
    args = ap.parse_args()

    cfg = yaml.safe_load(Path(args.config).read_text())
    total = args.total_timesteps or int(cfg["total_timesteps"])
    n_envs = args.n_envs or int(cfg.get("n_envs", 8))
    device = args.device or cfg.get("device", "cpu")
    seed = int(cfg.get("seed", 42))
    run_name = cfg.get("run_name", "ppo-booster")

    env_cfg = dict(cfg.get("env", {}))
    dr_cfg = dict(cfg["dr"]) if cfg.get("dr", {}).pop("enabled", False) else None
    manager = CurriculumManager(stages_from_config(cfg.get("curriculum", {}).get("stages")))

    ckpt_dir = Path(cfg.get("checkpoint", {}).get("dir", "checkpoints"))
    ckpt_dir.mkdir(parents=True, exist_ok=True)

    # Resume: restore curriculum stage before building workers.
    if args.resume_from and (ckpt_dir / "curriculum.json").exists():
        state = json.loads((ckpt_dir / "curriculum.json").read_text())
        manager.index = int(state.get("stage_index", 0))
    stage = manager.stage
    print(f"run={run_name} total={total:,} n_envs={n_envs} stage={stage.name}")

    venv = SubprocVecEnv([make_worker(env_cfg, dr_cfg, stage) for _ in range(n_envs)])
    venv = VecMonitor(venv)
    gamma = float(cfg.get("ppo", {}).get("gamma", 0.99))
    if args.resume_from and (ckpt_dir / "vecnormalize.pkl").exists():
        venv = VecNormalize.load(str(ckpt_dir / "vecnormalize.pkl"), venv)
        venv.training = True
    else:
        norm_reward = bool(cfg.get("normalize_reward", True))
        venv = VecNormalize(
            venv, norm_obs=False, norm_reward=norm_reward, gamma=gamma
        )

    algo_name = str(cfg.get("algo", "ppo")).lower()
    ALGO = {"ppo": PPO, "sac": SAC}[algo_name]
    ppo_cfg = dict(cfg.get(algo_name, cfg.get("ppo", {})))
    net_arch = ppo_cfg.pop("net_arch", [256, 256])
    policy_kwargs = {"net_arch": list(net_arch)}
    # Exploration noise scale: std=1.0 white noise on all actuators tumbles
    # the vehicle every rollout (500k-step diagnostic) — attitude stability
    # never appears in the training data. log_std_init + gSDE (smooth,
    # state-dependent noise; `use_sde` in the algo section) fix that.
    if "log_std_init" in ppo_cfg:
        policy_kwargs["log_std_init"] = float(ppo_cfg.pop("log_std_init"))
    tb_dir = f"runs/tb-{run_name}"

    if args.resume_from:
        model = ALGO.load(args.resume_from, env=venv, device=device,
                          tensorboard_log=tb_dir)
        print(f"resumed from {args.resume_from} @ {model.num_timesteps:,} steps")
    else:
        model = ALGO(
            "MlpPolicy",
            venv,
            policy_kwargs=policy_kwargs,
            tensorboard_log=tb_dir,
            seed=seed,
            device=device,
            verbose=1,
            **ppo_cfg,
        )
        if args.warm_start:
            # weights only — same algo + same net_arch required
            src = ALGO.load(args.warm_start, device=device)
            model.policy.load_state_dict(src.policy.state_dict())
            print(f"warm-started policy weights from {args.warm_start}")


    if args.demo_buffer:
        if algo_name != "sac":
            raise SystemExit("--demo-buffer requires algo: sac")
        if bool(cfg.get("normalize_reward", True)):
            raise SystemExit(
                "--demo-buffer requires normalize_reward: false "
                "(demo rewards are raw; a normalized env reward stream "
                "would put buffer and rollouts on different scales)"
            )
        d = np.load(args.demo_buffer)
        n = venv.num_envs
        total_t = (len(d["obs"]) // n) * n
        for i in range(0, total_t, n):
            sl = slice(i, i + n)
            model.replay_buffer.add(
                d["obs"][sl], d["next_obs"][sl], d["act"][sl],
                d["rew"][sl], d["done"][sl], [{} for _ in range(n)],
            )
        print(f"seeded replay buffer with {total_t:,} demo transitions")

    callbacks = [
        CurriculumEvalCallback(manager, env_cfg, cfg.get("eval", {}), ckpt_dir),
        CheckpointCallback(
            cfg.get("checkpoint", {}).get("freq_steps", 250_000), ckpt_dir, run_name
        ),
    ]

    # Manifest for downstream export (SLS-30): obs scaling + action layout.

    _write_manifest(ckpt_dir, run_name, env_cfg, gamma, cfg)

    try:
        model.learn(
            total_timesteps=total,
            callback=callbacks,
            reset_num_timesteps=not bool(args.resume_from),
            progress_bar=False,
        )
        print("training done.")
    except KeyboardInterrupt:
        # Wall-clock cap (campaign.py sends SIGINT): SB3 skips the
        # callbacks' _on_training_end on exceptions, so save here or a
        # capped run keeps only its last PERIODIC checkpoint.
        path = ckpt_dir / f"{run_name}_interrupted_{model.num_timesteps}.zip"
        model.save(path)
        venv_final = model.get_env()
        if isinstance(venv_final, VecNormalize):
            venv_final.save(str(ckpt_dir / "vecnormalize.pkl"))
        shutil.copyfile(path, ckpt_dir / "latest.zip")
        print(f"interrupted @ {model.num_timesteps:,}; saved {path.name}")


def _write_manifest(ckpt_dir, run_name, env_cfg, gamma, cfg):
    from rl.env import OBS_SCALE

    (ckpt_dir / "manifest.json").write_text(
        json.dumps(
            {
                "run_name": run_name,
                "obs_scale": OBS_SCALE.tolist(),
                "normalize_obs": bool(env_cfg.get("normalize_obs", False)),
                "booster_landing_action": bool(
                    env_cfg.get("booster_landing_action", False)
                ),
                "attitude_inner_loop": bool(
                    env_cfg.get("attitude_inner_loop", False)
                ),
                "frame_skip": int(env_cfg.get("frame_skip", 10)),
                "gamma": gamma,
                "config": cfg,
            },
            indent=2,
            default=str,
        )
    )


if __name__ == "__main__":
    main()
