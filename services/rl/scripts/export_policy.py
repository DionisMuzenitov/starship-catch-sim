"""Export the imitation-learned policy for the TS runtime (SLS-30).

Usage:
    uv run python scripts/export_policy.py \
        --checkpoint checkpoints-il/clone7_bc.zip \
        --out ../../apps/web/public/models/booster_policy.json \
        --fixture ../../packages/controllers/src/__fixtures__/rl_policy_parity.json

Emits ONE self-describing JSON artifact containing:
- the MLP weights (17 -> 256 -> 256 -> 4, tanh; deterministic action head
  only: extract_features -> mlp_extractor.policy_net -> action_net),
- the full runtime contract: obs layout + OBS_SCALE, action decode
  semantics (a <= 0 means engines OFF — the null-action decode, NOT
  (a+1)/2), inner-loop PD gains (K_ATT/K_RATE/LEAN_MAX, ADR-015), policy
  cadence (frame_skip over the 250 Hz physics step),
- provenance (checkpoint name, imitation-learned, eval numbers).

A pure-TS forward pass consumes this directly (SLS-30 decision: no ONNX —
a 2-layer MLP does not justify a 20 MB WASM runtime; revisit if nets grow).

Also writes a parity FIXTURE: N fixed observations with the Python policy's
deterministic actions, plus PD test vectors (attitude/rates/lean-targets ->
gimbal commands), so vitest can assert TS == Python within float tolerance.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from stable_baselines3 import PPO

from rl.env import K_ATT, K_RATE, LEAN_MAX, OBS_SCALE, StarshipCatchEnv
from rl.mathx import quat_conjugate, quat_rotate


def export_weights(model: PPO) -> dict:
    policy = model.policy
    # ActorCriticPolicy deterministic head: features(=flatten) -> policy_net -> action_net
    layers = []
    seq = list(policy.mlp_extractor.policy_net) + [policy.action_net]
    for mod in seq:
        if isinstance(mod, torch.nn.Linear):
            layers.append(
                {
                    "w": mod.weight.detach().numpy().tolist(),  # [out, in]
                    "b": mod.bias.detach().numpy().tolist(),
                }
            )
        elif isinstance(mod, torch.nn.Tanh):
            assert layers, "activation before first linear?"
            layers[-1]["activation"] = "tanh"
        else:
            raise SystemExit(f"unsupported module in policy head: {mod}")
    return {"layers": layers}


def torch_actions(model: PPO, obs: np.ndarray) -> np.ndarray:
    acts, _ = model.predict(obs, deterministic=True)
    return np.clip(acts, -1.0, 1.0)


def pd_gimbal(att_xyzw, omega, lean_x, lean_z, max_gimbal):
    """Reference implementation of the env inner-loop PD (body-frame)."""
    q = np.asarray(att_xyzw, dtype=np.float64)
    up = quat_rotate(q, np.array([0.0, 1.0, 0.0]))
    e_world = np.array([lean_x - up[0], 0.0, lean_z - up[2]])
    e_body = quat_rotate(quat_conjugate(q), e_world)
    gp = max(-1.0, min(1.0, -K_ATT * e_body[2] + K_RATE * omega[0])) * max_gimbal
    gy = max(-1.0, min(1.0, +K_ATT * e_body[0] + K_RATE * omega[2])) * max_gimbal
    return [float(gp), float(gy)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default="checkpoints-il/clone7_bc.zip")
    ap.add_argument("--out", required=True)
    ap.add_argument("--fixture", required=True)
    ap.add_argument("--n-fixture", type=int, default=8)
    args = ap.parse_args()

    model = PPO.load(args.checkpoint, device="cpu")
    env = StarshipCatchEnv(attitude_inner_loop=True, normalize_obs=True)
    max_gimbal = env._max_gimbal

    artifact = {
        "format": "sls-mlp-policy-v1",
        "provenance": {
            "checkpoint": Path(args.checkpoint).name,
            "method": "imitation (BC on scripted-cascade demos, SLS-51)",
            "eval": "full-calm 8/8, full-standard 7/8 clean (numpy env)",
        },
        "obs": {
            "layout": [
                "position xyz (m)", "velocity xyz (m/s)",
                "attitude quat xyzw", "angular velocity xyz (rad/s, body)",
                "fuel fraction", "position-minus-catch-point xyz (m)",
            ],
            "scale": OBS_SCALE.tolist(),
        },
        "action": {
            "layout": ["thr_centre", "thr_inner", "lean_x", "lean_z"],
            "decode": "clip to [-1,1]; throttle<=0 means engine group OFF, "
                      "(0,1] is direct throttle; lean_* x LEAN_MAX = "
                      "body-up target components",
            "policy_period_steps": 10,
        },
        "inner_loop_pd": {
            "k_att": K_ATT,
            "k_rate": K_RATE,
            "lean_max_rad": LEAN_MAX,
            "max_gimbal_rad": float(max_gimbal),
            "law": "e_body = R(q)^-1 [leanX-upX, 0, leanZ-upZ]; "
                   "gp = clip(-k_att*e_body_z + k_rate*wx) * max_gimbal; "
                   "gy = clip(+k_att*e_body_x + k_rate*wz) * max_gimbal; "
                   "runs every physics substep (250 Hz)",
        },
        "mlp": export_weights(model),
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(artifact))
    print(f"wrote {out} ({out.stat().st_size/1e6:.2f} MB)")

    # parity fixture: realistic-scale observations (normalized space)
    rng = np.random.default_rng(30)
    obs = np.zeros((args.n_fixture, 17))
    obs[:, 0:3] = rng.uniform(-0.2, 0.2, (args.n_fixture, 3))   # pos/scale
    obs[:, 1] = rng.uniform(0.001, 0.9, args.n_fixture)          # y positive
    obs[:, 3:6] = rng.uniform(-0.5, 0.1, (args.n_fixture, 3))   # vel/300
    q = rng.normal(0, 0.05, (args.n_fixture, 4)) + np.array([0, 0, 0, 1.0])
    obs[:, 6:10] = q / np.linalg.norm(q, axis=1, keepdims=True)
    obs[:, 10:13] = rng.uniform(-0.1, 0.1, (args.n_fixture, 3)) # omega/0.5
    obs[:, 13] = rng.uniform(0.05, 1.0, args.n_fixture)         # fuel frac
    obs[:, 14:17] = rng.uniform(-0.2, 0.2, (args.n_fixture, 3)) # rel/scale

    acts = torch_actions(model, obs.astype(np.float32))
    pd_cases = []
    for i in range(args.n_fixture):
        qi = obs[i, 6:10]
        omega = obs[i, 10:13] * 0.5  # un-normalize (scale 0.5)
        lean_x = float(np.clip(acts[i, 2], -1, 1)) * LEAN_MAX
        lean_z = float(np.clip(acts[i, 3], -1, 1)) * LEAN_MAX
        pd_cases.append(
            {
                "att_xyzw": qi.tolist(),
                "omega_body": omega.tolist(),
                "lean_x": lean_x,
                "lean_z": lean_z,
                "gimbal_pitch_yaw": pd_gimbal(qi, omega, lean_x, lean_z, max_gimbal),
            }
        )
    fixture = {
        "observations_normalized": obs.tolist(),
        "actions": acts.tolist(),
        "pd_cases": pd_cases,
    }
    fx = Path(args.fixture)
    fx.parent.mkdir(parents=True, exist_ok=True)
    fx.write_text(json.dumps(fixture, indent=1))
    print(f"wrote {fx} ({args.n_fixture} obs + PD cases)")


if __name__ == "__main__":
    main()
