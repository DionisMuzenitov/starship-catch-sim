"""Behaviour-cloning utilities shared by bc_pretrain / il_train (SLS-51).

The fit optimises the SB3 ActorCriticPolicy directly: MSE on the action mean
(the deterministic head used at eval/export time) plus an optional value-head
fit to undiscounted return-to-go (kept for RL-polish warm starts; harmless
for pure imitation).
"""

from __future__ import annotations

import numpy as np
import torch


def returns_to_go(rew: np.ndarray, ep: np.ndarray) -> np.ndarray:
    """Undiscounted per-episode return-to-go from flat reward/episode-id
    streams (episodes need not be contiguous-sorted, but ours are)."""
    rtg = np.zeros_like(rew, dtype=np.float64)
    # iterate episodes in reverse within their contiguous blocks
    boundaries = np.flatnonzero(np.diff(ep)) + 1
    starts = np.concatenate([[0], boundaries])
    ends = np.concatenate([boundaries, [len(ep)]])
    for s, e in zip(starts, ends):
        acc = 0.0
        for i in range(e - 1, s - 1, -1):
            acc += float(rew[i])
            rtg[i] = acc
    return rtg


def bc_fit(
    model,
    obs: np.ndarray,
    act: np.ndarray,
    ret: np.ndarray,
    epochs: int,
    batch: int,
    lr: float,
    value_coef: float = 0.5,
    val_frac: float = 0.05,
    log_every: int = 10,
) -> dict:
    """Supervised fit; returns {train_mse, val_mse} of the final epoch."""
    policy = model.policy
    device = policy.device
    n = len(obs)
    n_val = max(1, int(n * val_frac))
    perm0 = np.random.default_rng(0).permutation(n)
    vi, ti = perm0[:n_val], perm0[n_val:]

    obs_t = torch.as_tensor(obs[ti], dtype=torch.float32, device=device)
    act_t = torch.as_tensor(act[ti], dtype=torch.float32, device=device)
    ret_t = torch.as_tensor(ret[ti], dtype=torch.float32, device=device)
    obs_v = torch.as_tensor(obs[vi], dtype=torch.float32, device=device)
    act_v = torch.as_tensor(act[vi], dtype=torch.float32, device=device)

    opt = torch.optim.Adam(policy.parameters(), lr=lr)
    m = len(obs_t)
    policy.set_training_mode(True)
    last = {}
    for epoch in range(epochs):
        idx = torch.randperm(m, device=device)
        tot_a = 0.0
        for i in range(0, m, batch):
            sl = idx[i : i + batch]
            feats = policy.extract_features(obs_t[sl])
            lp, lv = policy.mlp_extractor(feats)
            mean = policy.action_net(lp)
            values = policy.value_net(lv).squeeze(-1)
            loss_a = torch.nn.functional.mse_loss(mean, act_t[sl])
            loss_v = torch.nn.functional.mse_loss(values, ret_t[sl])
            loss = loss_a + value_coef * loss_v
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot_a += float(loss_a) * len(sl)
        if epoch % log_every == 0 or epoch == epochs - 1:
            with torch.no_grad():
                feats = policy.extract_features(obs_v)
                lp, _ = policy.mlp_extractor(feats)
                val_mse = float(
                    torch.nn.functional.mse_loss(policy.action_net(lp), act_v)
                )
            last = {"train_mse": tot_a / m, "val_mse": val_mse}
            print(f"epoch {epoch:3d}  train-mse {last['train_mse']:.5f}  "
                  f"val-mse {last['val_mse']:.5f}", flush=True)
    policy.set_training_mode(False)
    return last
