"""Plot the PPO learning curve from TensorBoard logs (SLS-29).

Usage:
    uv run python scripts/plot_learning.py --tb-dir runs/tb-ppo-booster \
        [--out runs/learning-curve.png]
"""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator


def load_scalar(run_dir: Path, tag: str):
    steps, values = [], []
    for events_dir in sorted(run_dir.glob("**/events.out.tfevents.*")):
        acc = EventAccumulator(str(events_dir.parent), size_guidance={"scalars": 0})
        acc.Reload()
        if tag in acc.Tags().get("scalars", []):
            for e in acc.Scalars(tag):
                steps.append(e.step)
                values.append(e.value)
    order = sorted(range(len(steps)), key=lambda i: steps[i])
    return [steps[i] for i in order], [values[i] for i in order]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tb-dir", required=True)
    ap.add_argument("--out", default="runs/learning-curve.png")
    args = ap.parse_args()
    run_dir = Path(args.tb_dir)

    fig, axes = plt.subplots(1, 3, figsize=(15, 4))
    panels = [
        ("rollout/ep_rew_mean", "episode reward (train, DR on)"),
        ("eval/success_rate", "eval success rate (deterministic)"),
        ("eval/stage_index", "curriculum stage"),
    ]
    for ax, (tag, title) in zip(axes, panels):
        steps, values = load_scalar(run_dir, tag)
        if steps:
            ax.plot(steps, values)
        ax.set_title(title)
        ax.set_xlabel("env steps")
        ax.grid(True, alpha=0.3)
    axes[1].set_ylim(-0.05, 1.05)
    fig.suptitle(f"PPO booster catch — {run_dir.name}")
    fig.tight_layout()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, dpi=120)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
