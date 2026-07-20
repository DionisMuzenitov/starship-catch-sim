"""StarshipCatchEnv smoke + reward-sanity tests (SLS-28).

Includes the ticket's reward-sign check: a reasonable braking policy must earn
a higher average return than random flailing, and a caught terminal must score
strictly above a crash terminal.
"""

from __future__ import annotations

import numpy as np
import pytest

from rl import consts as C
from rl.env import StarshipCatchEnv, make_env


def test_spaces_and_reset():
    env = StarshipCatchEnv()
    obs, info = env.reset(seed=0)
    assert env.observation_space.shape == (17,)
    assert obs.shape == (17,)
    assert np.all(np.isfinite(obs))
    # booster: 4 throttles + 2 gimbal + 4 fins = 10-dim action.
    assert env.action_space.shape == (10,)


def test_step_runs_and_is_finite():
    env = StarshipCatchEnv()
    env.reset(seed=1)
    for _ in range(50):
        obs, r, term, trunc, info = env.step(np.zeros(env.n_act))
        assert np.all(np.isfinite(obs))
        assert np.isfinite(r)
        if term or trunc:
            break
    assert "outcome" in info


def test_reset_is_seeded():
    a = StarshipCatchEnv().reset(seed=42)[0]
    b = StarshipCatchEnv().reset(seed=42)[0]
    c = StarshipCatchEnv().reset(seed=43)[0]
    assert np.allclose(a, b)
    assert not np.allclose(a, c)


def test_vector_env_runs():
    import gymnasium as gym

    venv = gym.vector.SyncVectorEnv([make_env(), make_env()])
    obs, _ = venv.reset(seed=0)
    assert obs.shape == (2, 17)
    actions = np.zeros((2, venv.single_action_space.shape[0]))
    obs, rewards, term, trunc, _ = venv.step(actions)
    assert obs.shape == (2, 17)
    assert rewards.shape == (2,)
    venv.close()


def _episode_return(env, policy, seed, steps):
    obs, _ = env.reset(seed=seed)
    total = 0.0
    for _ in range(steps):
        obs, r, term, trunc, _ = env.step(policy(obs, env))
        total += r
        if term or trunc:
            break
    return total


def _brake_policy(obs, env):
    # Descending fast → throttle centre + inner to decelerate; no gimbal/surf.
    # (obs[4] = vertical velocity; more negative = faster descent.)
    return np.array([0.6, 0.4, -1.0, -1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])


def _random_policy(obs, env):
    return env.action_space.sample()


def test_reward_sign_brake_beats_random():
    """A braking policy (reduces descent speed → approaches the shaping
    potential's optimum) must out-return random flailing on average."""
    steps = 200
    seeds = range(6)
    brake = StarshipCatchEnv()
    rnd = StarshipCatchEnv()
    rnd.action_space.seed(0)
    brake_ret = np.mean([_episode_return(brake, _brake_policy, s, steps) for s in seeds])
    random_ret = np.mean([_episode_return(rnd, _random_policy, s, steps) for s in seeds])
    assert brake_ret > random_ret, (
        f"reward mis-signed: brake return {brake_ret:.2f} "
        f"should exceed random {random_ret:.2f}"
    )


def test_caught_scores_above_crash():
    """A caught terminal must earn strictly more than a crash terminal."""
    env = StarshipCatchEnv()
    env.reset(seed=0)

    # Force a catch-satisfying state at the capture target and step once.
    target = C.SCENARIOS["booster-descent-calm"].target_position
    env.world.position = target.copy()
    env.world.velocity = np.zeros(3)
    env.world.angular_velocity = np.zeros(3)
    env.world.attitude = np.array([0.0, 0.0, 0.0, 1.0])  # upright
    env._prev_phi = env._potential(env.world)
    _, r_catch, term_c, _, info_c = env.step(np.full(env.n_act, -1.0))
    assert info_c["outcome"] == "caught" and term_c

    # Force a ground-crash state.
    env.reset(seed=0)
    env.world.position = np.array([0.0, -0.1, 0.0])
    env._prev_phi = env._potential(env.world)
    _, r_crash, term_x, _, info_x = env.step(np.full(env.n_act, -1.0))
    assert info_x["outcome"] == "crash" and term_x

    assert r_catch > r_crash


def test_fuel_penalty_scales_with_kg_burned(monkeypatch):
    """SLS-80 guardrail: reward drops by exactly W_FUEL·(kg burned), and burning
    is penalised. Two seed-identical envs differ ONLY in W_FUEL, so the dynamics
    (hence fuel burned + shaping + W_CTRL term) are identical and the propellant
    term is isolated. Guards against a future sign-flip / mis-scale of the term
    the ticket ships to discipline fuel use."""
    import rl.env as E

    def run(w_fuel: float) -> tuple[float, float]:
        monkeypatch.setattr(E, "W_FUEL", w_fuel)
        env = E.StarshipCatchEnv()
        env.reset(seed=0)
        prop0 = float(env.world.propellant_mass)
        # Full throttle → the engines actually burn this step.
        _, r, _, _, info = env.step(np.full(env.n_act, 1.0))
        return r, prop0 - float(info["fuel"])

    r_free, burned = run(0.0)
    r_pen, burned2 = run(3.0e-5)

    assert burned > 0.0  # full throttle really burned propellant
    assert burned == pytest.approx(burned2, rel=1e-6)  # identical dynamics
    assert r_pen < r_free  # burning is penalised
    assert (r_free - r_pen) == pytest.approx(3.0e-5 * burned, rel=1e-5)
