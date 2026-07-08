"""SLS-29 unit tests: domain randomization, wind fields, curriculum, and the
vectorized-plant env additions. numpy-only — runs in CI without torch."""

from __future__ import annotations

import numpy as np

from rl import consts as C
from rl.ballistic import sample_start
from rl.curriculum import DEFAULT_STAGES, CurriculumManager, Stage, stages_from_config
from rl.dr import DomainRandomizationWrapper, DRConfig, perturb_vehicle
from rl.env import StarshipCatchEnv
from rl.wind_np import CalmWind, OUTurbulence, build_wind

RNG = np.random.default_rng(0)


# --- DR ----------------------------------------------------------------------


def test_perturb_vehicle_within_ranges():
    base = C.VEHICLES["booster"]
    cfg = DRConfig()
    for seed in range(20):
        v = perturb_vehicle(base, np.random.default_rng(seed), cfg)
        for e, be in zip(v.engines, base.engines):
            assert abs(e.thrust_vac / be.thrust_vac - 1) <= cfg.thrust_frac + 1e-12
            assert abs(e.isp_vac / be.isp_vac - 1) <= cfg.isp_frac + 1e-12
            assert abs(e.tau_throttle / be.tau_throttle - 1) <= cfg.tau_frac + 1e-12
        dm = v.mass_props.dry_mass / base.mass_props.dry_mass
        assert abs(dm - 1) <= cfg.mass_frac + 1e-12
        # dry inertia scales with dry mass (same factor)
        ratio = v.mass_props.dry_inertia[0] / base.mass_props.dry_inertia[0]
        assert abs(ratio - dm) < 1e-12


def test_perturbation_does_not_mutate_base():
    base = C.VEHICLES["booster"]
    t0 = base.engines[0].thrust_vac
    perturb_vehicle(base, np.random.default_rng(1), DRConfig())
    assert base.engines[0].thrust_vac == t0


def test_dr_wrapper_is_seeded_and_perturbs():
    def mk():
        return DomainRandomizationWrapper(StarshipCatchEnv())

    a, b, c = mk(), mk(), mk()
    oa, _ = a.reset(seed=7)
    ob, _ = b.reset(seed=7)
    oc, _ = c.reset(seed=8)
    assert np.allclose(oa, ob)
    assert not np.allclose(oa, oc)
    # plant actually perturbed away from nominal
    nom = C.VEHICLES["booster"].engines[0].thrust_vac
    assert a.unwrapped.vehicle.engines[0].thrust_vac != nom


# --- wind --------------------------------------------------------------------


def test_build_wind_calm_and_layered():
    calm = build_wind({"kind": "constant", "value": [0, 0, 0]})
    assert isinstance(calm, CalmWind)
    spec = C.SCENARIOS["booster-descent-standard"].wind_spec
    w = build_wind(spec)
    ground = w.at(np.array([0.0, 0.0, 0.0]), 0.0)
    high = w.at(np.array([0.0, 30_000.0, 0.0]), 0.0)
    assert ground[0] == 5.0 and high[0] == 20.0  # layer means from scenarios.ts


def test_wind_layer_offset_and_turbulence_scale():
    spec = C.SCENARIOS["booster-descent-stormy"].wind_spec
    w = build_wind(spec, layer_offset=np.array([3.0, 0.0, 0.0]), turbulence_scale=2.0)
    w.reset(np.random.default_rng(0))
    v = w.at(np.array([0.0, 0.0, 0.0]), 0.0)
    assert np.isfinite(v).all()
    ou = w.fields[1]
    assert isinstance(ou, OUTurbulence)
    assert np.allclose(ou.sigma, np.array([6.0, 1.0, 6.0]) * 2.0)


def test_ou_turbulence_stats():
    ou = OUTurbulence(sigma=np.array([5.0, 1.0, 5.0]), tau=np.array([2.0, 2.0, 2.0]))
    ou.reset(np.random.default_rng(42))
    xs = []
    for _ in range(20_000):
        ou.step(0.02)
        xs.append(ou.state.copy())
    xs = np.array(xs)
    std = xs.std(axis=0)
    # stationary std should approximate sigma (loose tolerance, finite sample)
    assert np.all(np.abs(std / np.array([5.0, 1.0, 5.0]) - 1.0) < 0.25)


# --- ballistic starts + curriculum --------------------------------------------


def test_sample_start_is_savable():
    """Ballistic sampling only returns SAVABLE states (13-engine braking can
    null the descent above the catch point) — a raw low band still carries
    ~-700 m/s and is physically unsavable, so the sampler filters and, if the
    requested band has no savable states, falls back to ones that do
    (SLS-51 energy analysis)."""
    for seed in range(5):
        w = sample_start(
            "booster-descent-calm", (2_000.0, 5_000.0), np.random.default_rng(seed)
        )
        alt_above = w.position[1] - 91.0
        assert w.velocity[1] ** 2 <= 2.0 * 30.0 * alt_above  # savable
        assert w.velocity[1] < -100.0  # descending
        assert w.t == 0.0


def test_curriculum_promotion_chain():
    cm = CurriculumManager(DEFAULT_STAGES)
    names = [cm.stage.name]
    assert not cm.update(0.5)  # below bar: stay
    for _ in range(10):
        if cm.update(0.95):
            names.append(cm.stage.name)
    assert names == [s.name for s in DEFAULT_STAGES]
    assert cm.finished
    assert not cm.update(1.0)  # terminal stage never promotes


def test_stages_from_config_roundtrip():
    raw = [
        {"name": "a", "scenario_id": "booster-descent-calm",
         "start_alt_range": [1000, 2000], "promote_at": 0.7},
        {"name": "b", "scenario_id": "booster-descent-standard",
         "start_alt_range": None},
    ]
    stages = stages_from_config(raw)
    assert stages[0] == Stage("a", "booster-descent-calm", (1000, 2000), 0.7)
    assert stages[1].start_alt_range is None and stages[1].promote_at == 0.8


# --- env additions -------------------------------------------------------------


def test_masked_action_space_and_obs_norm():
    env = StarshipCatchEnv(booster_landing_action=True, normalize_obs=True)
    obs, _ = env.reset(seed=0)
    assert env.action_space.shape == (8,)
    assert np.abs(obs).max() < 5.0  # normalized to ~O(1)
    obs, r, term, trunc, _ = env.step(np.zeros(8))
    assert np.isfinite(r) and obs.shape == (17,)


def test_set_stage_switches_scenario_and_band():
    corridor = {"kind": "corridor", "alt_above": (100.0, 500.0), "lateral": 100.0,
                "vy": (-40.0, -5.0)}
    env = StarshipCatchEnv(start_alt_range=corridor)
    env.reset(seed=0)
    assert env.world.position[1] < 700.0
    env.set_stage(scenario_id="booster-descent-standard", start_alt_range=None)
    env.reset(seed=0)
    assert env.scenario_id == "booster-descent-standard"
    assert env.world.position[1] > 60_000.0


def test_stormy_wind_perturbs_trajectory():
    def run(scenario):
        env = StarshipCatchEnv(scenario_id=scenario, position_jitter_m=0.0,
                               velocity_jitter_frac=0.0)
        env.reset(seed=0)
        for _ in range(40):
            env.step(np.zeros(env.n_act))
        return env.world.position.copy()

    calm = run("booster-descent-calm")
    stormy = run("booster-descent-stormy")
    assert not np.allclose(calm, stormy)  # wind actually acts on the plant


# --- graded terminal reward (SLS-29) -------------------------------------------


def test_graded_terminal_slow_close_beats_fast_far():
    """A slow, close, upright crash must outscore a fast, far one — the
    gradient through the terminal event that flat -R_FAIL lacked."""

    def crash_reward(pos, vel):
        env = StarshipCatchEnv(position_jitter_m=0.0, velocity_jitter_frac=0.0)
        env.reset(seed=0)
        env.world.position = np.array(pos, dtype=float)
        env.world.velocity = np.array(vel, dtype=float)
        env.world.attitude = np.array([0.0, 0.0, 0.0, 1.0])
        env.world.angular_velocity = np.zeros(3)
        env._prev_phi = env._potential(env.world)
        for _ in range(200):  # step to termination — engines OFF (action -1
            # maps to zero throttle; action 0 would be 50 % thrust)
            _, r, term, _, info = env.step(np.full(env.n_act, -1.0))
            if term:
                break
        assert term and info["outcome"] in ("crash", "tower_collision")
        return r

    close_slow = crash_reward([8.5, 3.0, 0.0], [0.0, -6.0, 0.0])
    far_fast = crash_reward([3000.0, 3.0, 0.0], [0.0, -250.0, 0.0])
    assert close_slow > far_fast + 5.0


def test_graded_terminal_never_beats_catch():
    from rl.env import R_CATCH, R_FAIL, R_MISS_BONUS

    # best possible failure (-R_FAIL + R_MISS_BONUS) stays far below a catch
    assert -R_FAIL + R_MISS_BONUS < R_CATCH
    assert R_MISS_BONUS < R_FAIL  # failures always net-negative
