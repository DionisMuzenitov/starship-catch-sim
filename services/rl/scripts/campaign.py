"""Overnight training-campaign orchestrator (SLS-51).

Usage (the one night-time command):
    cd services/rl && nohup uv run python scripts/campaign.py \
        --plan configs/campaign-night1.yaml > runs/campaign.log 2>&1 &

Executes the plan's runs SEQUENTIALLY. Per run:
  1. optional BC pretrain (skipped if the warm-start zip already exists),
  2. training via train_ppo.py, hard-capped by `hours` (SIGINT → periodic
     checkpoints survive; latest.zip is always the newest),
  3. eval_policy.py on the best available checkpoint,
  4. plot_learning.py → PNG.

Writes runs/campaign-<plan-name>/summary.json as it goes — check that (or
tail runs/campaign.log) in the morning. A crashed run is recorded and the
campaign moves on; it never takes the whole night down with it.

Plan schema (YAML):
    name: night1
    runs:
      - name: A-ppo-il-bc
        config: configs/ppo-booster-il.yaml
        hours: 4
        total_timesteps: 12_000_000   # optional cap besides the clock
        bc:                            # optional warm start
          episodes: 30
          epochs: 60
      - name: B-ppo-il
        config: configs/ppo-booster-il.yaml
        hours: 2
"""

from __future__ import annotations

import argparse
import json
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

import yaml

RL_DIR = Path(__file__).resolve().parents[1]


def sh(cmd: list[str], timeout_s: float | None = None, log: Path | None = None) -> int:
    """Run a child, streaming to `log`; on timeout send SIGINT and wait so
    SB3 unwinds and periodic checkpoints stay valid."""
    out = open(log, "ab") if log else None
    proc = subprocess.Popen(cmd, cwd=RL_DIR, stdout=out or sys.stdout,
                            stderr=subprocess.STDOUT)
    try:
        return proc.wait(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        proc.send_signal(signal.SIGINT)
        try:
            proc.wait(timeout=120)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        return -2  # our marker: wall-clock budget expired
    finally:
        if out:
            out.close()


def run_one(run: dict, out_dir: Path) -> dict:
    name = run["name"]
    config = run["config"]
    hours = float(run.get("hours", 2.0))
    cfg = yaml.safe_load((RL_DIR / config).read_text())
    ckpt_dir = RL_DIR / f"checkpoints-{name}"
    log = out_dir / f"{name}.log"
    rec: dict = {"name": name, "config": config, "hours": hours,
                 "started": time.strftime("%Y-%m-%d %H:%M:%S")}

    # per-run checkpoint dir: rewrite the config copy so runs never collide
    cfg["checkpoint"] = dict(cfg.get("checkpoint", {}), dir=str(ckpt_dir))
    cfg["run_name"] = name
    run_config = out_dir / f"{name}.config.yaml"
    run_config.write_text(yaml.safe_dump(cfg, sort_keys=False))

    train_cmd = ["uv", "run", "python", "scripts/train_ppo.py",
                 "--config", str(run_config)]
    if run.get("total_timesteps"):
        train_cmd += ["--total-timesteps", str(int(run["total_timesteps"]))]

    # optional BC warm start
    if run.get("bc"):
        bc = run["bc"]
        warm = ckpt_dir / "bc_warmstart.zip"
        if not warm.exists():
            print(f"[{name}] BC pretrain...", flush=True)
            code = sh(
                ["uv", "run", "python", "scripts/bc_pretrain.py",
                 "--config", str(run_config), "--out", str(warm),
                 "--episodes", str(bc.get("episodes", 30)),
                 "--epochs", str(bc.get("epochs", 60))],
                timeout_s=3600, log=log,
            )
            rec["bc_exit"] = code
            if code != 0:
                rec["status"] = "bc_failed"
                return rec
        train_cmd += ["--warm-start", str(warm)]

    print(f"[{name}] training (cap {hours} h)...", flush=True)
    t0 = time.time()
    code = sh(train_cmd, timeout_s=hours * 3600, log=log)
    rec["train_exit"] = code
    rec["train_wall_s"] = round(time.time() - t0)

    best = ckpt_dir / "best.zip"
    latest = ckpt_dir / "latest.zip"
    ckpt = best if best.exists() else latest
    if not ckpt.exists():
        rec["status"] = "no_checkpoint"
        return rec

    print(f"[{name}] eval ({ckpt.name})...", flush=True)
    sh(["uv", "run", "python", "scripts/eval_policy.py",
        "--checkpoint", str(ckpt),
        "--episodes", str(int(run.get("eval_episodes", 30))),
        "--n-envs", "6"],
       timeout_s=3600, log=log)
    sh(["uv", "run", "python", "scripts/plot_learning.py",
        "--tb-dir", f"runs/tb-{name}",
        "--out", str(out_dir / f"{name}-learning-curve.png")],
       timeout_s=600, log=log)

    # surface the curriculum + eval tail into the summary
    cur = ckpt_dir / "curriculum.json"
    if cur.exists():
        rec["curriculum"] = json.loads(cur.read_text())
    evals = sorted((RL_DIR / "eval" / "results").glob("rl-*.json"))
    if evals:
        rec["eval"] = json.loads(evals[-1].read_text())["results"]
    rec["status"] = "done"
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", required=True)
    args = ap.parse_args()
    plan = yaml.safe_load(Path(args.plan).read_text())
    out_dir = RL_DIR / "runs" / f"campaign-{plan['name']}"
    out_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args.plan, out_dir / "plan.yaml")

    summary = {"plan": plan["name"],
               "started": time.strftime("%Y-%m-%d %H:%M:%S"), "runs": []}
    for run in plan["runs"]:
        try:
            rec = run_one(run, out_dir)
        except Exception as e:  # noqa: BLE001 — a broken run must not end the night
            rec = {"name": run.get("name", "?"), "status": "crashed",
                   "error": repr(e)}
        summary["runs"].append(rec)
        (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
        print(f"[{rec['name']}] -> {rec.get('status')}", flush=True)

    summary["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    print("campaign complete.", flush=True)


if __name__ == "__main__":
    main()
