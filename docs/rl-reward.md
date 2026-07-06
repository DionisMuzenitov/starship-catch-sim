# RL reward design (SLS-28)

> Reward design is *the* failure mode in RL projects. This doc is the source of
> truth for the `StarshipCatchEnv` reward; change the code and this together.

## Goal

Train a policy that flies the Super Heavy booster (and, later, Starship) into
the tower catch envelope — soft, upright, centred, low rates — without wasting
propellant, and without rewarding degenerate behaviour.

## Shape: sparse terminal + potential-based dense shaping

```
r_t = [γ·Φ(s_{t+1}) − Φ(s_t)]        # dense shaping (potential-based)
      − W_CTRL · Σ throttle           # control-effort / fuel penalty
      + R_terminal                     # sparse, only on episode end
```

### Why potential-based shaping

A hand-tuned dense reward ("give +x for getting closer") almost always changes
the optimal policy — it creates reward cycles the agent farms instead of
solving the task. **Potential-based shaping** (Ng, Harada & Russell, 1999)
adds `F(s,s') = γ·Φ(s') − Φ(s)` for an arbitrary potential `Φ`. Its telescoping
sum over an episode is `γ^T·Φ(s_T) − Φ(s_0)`, which depends only on the
endpoints — so it is provably **policy-invariant**: the optimal policy of the
shaped MDP equals that of the sparse MDP. We get dense gradient without moving
the optimum. `γ` here MUST equal the training discount (SLS-29) for the
invariance to hold exactly.

### The potential Φ(s)

`Φ` is higher (less negative) the closer the vehicle is to a catchable state:

```
Φ(s) = −( W_POS·‖r − r_target‖             # distance to the catch point
        + W_VSPEED·|v_y|                    # vertical speed
        + W_HSPEED·‖(v_x, v_z)‖             # horizontal speed
        + W_TILT·tilt_from_upright )        # attitude error
```

Defaults (`env.py`): `W_POS=1e-3` /m, `W_VSPEED=5e-3` /(m/s), `W_HSPEED=5e-3`
/(m/s), `W_TILT=0.2` /rad. These normalise the four terms to comparable scale
over a descent from 65 km (distance term ~65 at the top, speed terms ~1, tilt
term <1), so no single term dominates the early shaping gradient.

### Terminal rewards (sparse)

| Outcome | Reward | Rationale |
|---|---|---|
| `caught` | **+R_CATCH** (100) | inside the capture volume AND within the scenario envelope (position/vy/vh/tilt/rate). The goal. |
| `crash` | −R_FAIL (100) | ground impact (y ≤ 0). |
| `tower_collision` | −R_FAIL | inside the tower structure AABB, not caught. |
| `near_miss` | −R_FAIL | inside the capture volume but envelope violated (too fast / tilted). Terminal so the agent can't loiter in the volume farming shaping. |
| `fuel_exhausted` | −R_FAIL | propellant hit zero — no authority left. |
| timeout | 0 (truncated) | not a Markov terminal; bootstrap value as usual. |

Terminal magnitudes dwarf per-step shaping so the sparse signal dominates the
return once the agent is near the tower.

### Control-effort penalty

`−W_CTRL·Σ throttle` (default `W_CTRL=1e-3`) nudges toward fuel efficiency and
away from chattering full-throttle policies. Kept small so it never overrides
the shaping/terminal signal — it breaks ties between equally-good trajectories.

## Validation (the cheap, reliable check)

The classic RL-reward smoke test (per the ticket): **a reasonable policy must
earn positive-relative return; random must not.** `tests/test_env.py` encodes
two invariants:

- `test_reward_sign_brake_beats_random`: a braking policy (reduces descent
  speed → climbs the potential) out-returns random flailing, averaged over
  seeds. If this fails, the reward is mis-signed.
- `test_caught_scores_above_crash`: a caught terminal scores strictly above a
  crash terminal.

When SLS-29 lands training, the stronger check is: a trained policy's mean
return must exceed the PID baseline's on the same env.

## Deliberate non-goals (v1)

- No reward for *style* (fuel-optimal trajectories, specific gimbal profiles) —
  the terminal + light control penalty is enough; over-specifying invites
  reward hacking.
- No curriculum shaping here — curriculum + domain randomization are SLS-29.
- Wind disturbance in the env is calm for v1; randomised in SLS-29.
