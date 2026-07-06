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

Defaults (`env.py`): `W_POS=5e-3` /m, `W_VSPEED=2.5e-2` /(m/s),
`W_HSPEED=2.5e-2` /(m/s), `W_TILT=1.0` /rad. **Scale matters** (SLS-29
smoke-run finding): at the original ×5-smaller weights the telescoped shaping
contributed ~±3 per episode against a −100 terminal, and PPO saw a flat
return for 150k steps. The current scale makes shaping O(10–50) per episode —
commensurate with, but still below, the terminal. Scaling Φ is always safe:
potential-based shaping is policy-invariant for *any* Φ.

### Terminal rewards (sparse, graded on failure)

| Outcome | Reward | Rationale |
|---|---|---|
| `caught` | **+R_CATCH** (100) | inside the capture volume AND within the scenario envelope (position/vy/vh/tilt/rate). The goal. |
| any failure | −R_FAIL + R_MISS_BONUS·e^(−miss/4) ∈ (−100, −40] | graded by terminal closeness-to-catchable (see below). |
| timeout | 0 (truncated) | not a Markov terminal; bootstrap value as usual. |

Failure outcomes (`crash`, `tower_collision`, `near_miss`, `fuel_exhausted`)
share the graded formula. `miss` is the envelope-normalised distance from
catchable — `Σ max(0, error/tolerance − 1)` over position, vertical speed,
horizontal speed, and tilt — so `miss = 0` means "violated nothing but the
capture-volume geometry" (best failure, −40) and a ballistic ground impact
kilometres out scores ≈ −100.

**Why graded, not flat (SLS-29 finding):** with a flat −100 on every failure,
the 150k-step smoke run sat at ep_rew ≈ −91 with zero movement — a chance
catch is unreachable by exploration (five simultaneous tolerances inside a
7×8×10 m box), so every trajectory ended in the same terminal and PPO had no
gradient *through* the terminal event. Grading restores that gradient
("crash slower, closer, more upright" is strictly better) while preserving
the ordering `caught (+100) ≫ best failure (−40) > worst (−100)`. The bonus
is terminal-only, so it cannot be farmed as a reward cycle, and hovering to
avoid the penalty is closed off by fuel exhaustion (itself graded).

Terminal magnitudes still dwarf per-step shaping, so the sparse signal
dominates the return once the agent is near the tower.

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

### The curriculum interacts with the reward (SLS-29 diagnostic)

The nominal ballistic trajectory deliberately lands **~800 m past the tower**
(SLS-49 safety offset). Consequently every ballistic-start episode embeds a
large powered divert, and a scripted vertical suicide-burn still terminates
~790 m out — the reward gradient exists but the first success is unreachable.
The curriculum therefore opens with **corridor starts** (above the catch
point, small lateral offset — the state class MPC's dock phase reaches),
where a crude hand cascade already produces near-misses, and expands to
ballistic starts only after the terminal envelope is learned. An **escape
terminal** (leaving the flight envelope ends the episode, graded like any
failure) closes off the "fly away on 50 % throttle" exploration mode.

## Deliberate non-goals (v1)

- No reward for *style* (fuel-optimal trajectories, specific gimbal profiles) —
  the terminal + light control penalty is enough; over-specifying invites
  reward hacking.
- No curriculum shaping here — curriculum + domain randomization are SLS-29.
- Wind disturbance in the env is calm for v1; randomised in SLS-29.
