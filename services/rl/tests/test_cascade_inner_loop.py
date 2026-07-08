"""SLS-51 tests: attitude inner loop, cascade teacher, corridor-side sampling.
Torch-dependent BC tests skip when the train group isn't installed (CI)."""

from __future__ import annotations

import numpy as np
import pytest

from rl.ballistic import corridor_start
from rl.cascade import CascadeParams, cascade_action, rollout_cascade
from rl.env import LEAN_MAX, StarshipCatchEnv

HOVER = {
    "kind": "corridor", "alt_above": (60.0, 180.0), "lateral": 25.0,
    "vy": (-10.0, -2.0), "vh": 2, "tilt": 0.02, "omega": 0.005,
}


def _il_env(**kw):
    return StarshipCatchEnv(
        attitude_inner_loop=True, normalize_obs=True, start_alt_range=HOVER,
        position_jitter_m=0.0, velocity_jitter_frac=0.0, gamma=1.0, **kw,
    )


def test_inner_loop_action_space_and_step():
    env = _il_env()
    assert env.action_space.shape == (4,)
    obs, _ = env.reset(seed=0)
    obs, r, term, trunc, _ = env.step(np.array([0.8, 0.0, 0.1, -0.1]))
    assert obs.shape == (17,) and np.isfinite(r)


def test_inner_loop_tracks_lean_target():
    """Step response: commanded lean must be reached without gross overshoot
    (the SLS-51 gain sweep: K_ATT=4/K_RATE=8 settles on target)."""
    from rl.mathx import quat_rotate

    env = _il_env()
    env.reset(seed=0)
    a = np.array([0.84, 0.0, 1.0, 0.0])  # hover thrust + full lean_x
    peaks = []
    for _ in range(120):
        _, _, term, _, _ = env.step(a)
        up = quat_rotate(env.world.attitude, np.array([0.0, 1.0, 0.0]))
        peaks.append(float(up[0]))
        if term:
            break
    tr = np.array(peaks)
    assert tr.max() < 1.5 * LEAN_MAX  # no gross overshoot
    assert abs(tr[-15:].mean() - LEAN_MAX) < 0.4 * LEAN_MAX  # tracks target


def test_corridor_starts_stay_on_catch_side():
    """The truss occupies x ∈ [-6,6]; starts must not require flying through
    it (mirrored across x=8 — SLS-51 collision trace)."""
    spec = {"alt_above": (100.0, 500.0), "lateral": 100.0, "vy": (-40.0, -5.0)}
    for seed in range(30):
        w = corridor_start("booster-descent-calm", spec, np.random.default_rng(seed))
        assert w.position[0] >= 8.0


def test_cascade_catches_hover_stage():
    """The teacher must actually catch from the easiest corridor — this is
    the existence proof the BC warm start rests on."""
    env = _il_env()
    _, _, outcome, ret = rollout_cascade(env, seed=2, max_steps=1500)
    assert outcome == "caught"
    assert ret > 90.0


def test_cascade_action_bounds():
    env = _il_env()
    env.reset(seed=0)
    for _ in range(50):
        a = cascade_action(env, CascadeParams())
        assert a.shape == (4,)
        assert np.all(a >= -1.0) and np.all(a <= 1.0)
        env.step(a)


def test_rollout_alignment():
    env = _il_env()
    obs, act, outcome, _ = rollout_cascade(env, seed=0, max_steps=100)
    assert len(obs) == len(act)
    assert obs.shape[1] == 17 and act.shape[1] == 4


def test_bc_fit_reduces_action_mse():
    torch = pytest.importorskip("torch")
    from stable_baselines3 import PPO

    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    from bc_pretrain import bc_fit

    env = _il_env()
    obs, act, _, _ = rollout_cascade(env, seed=0, max_steps=300)
    ret = np.zeros(len(obs))
    model = PPO("MlpPolicy", _il_env(), device="cpu",
                policy_kwargs={"net_arch": [32, 32]}, n_steps=64)

    def mse():
        with torch.no_grad():
            o = torch.as_tensor(obs, dtype=torch.float32)
            feats = model.policy.extract_features(o)
            lp, _ = model.policy.mlp_extractor(feats)
            mean = model.policy.action_net(lp).numpy()
        return float(np.mean((mean - act) ** 2))

    before = mse()
    bc_fit(model, obs, act, ret, epochs=15, batch=64, lr=1e-3)
    after = mse()
    assert after < 0.5 * before  # cloning actually fits the teacher
