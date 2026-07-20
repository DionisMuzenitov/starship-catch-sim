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

**γ must match the episode timescale (SLS-29 finding — the procrastination
exploit).** At 25 Hz control, γ=0.99 gives a ~4 s effective horizon
(γ^480 ≈ 0.008). The trained policy discovered that *delaying* the −100
terminal until step ~480 (by flying up and away until the escape bound)
makes the penalty vanish from the discounted objective — diagnostic rollouts
showed every episode ending `escaped` at ~2.3 km, ascending, tumbling.
Equally, a catch bonus 300 steps ahead was invisible from the episode start.
A first fix (γ=0.999) only moved the crossover: escaping at step 500 still
beat crashing at step 140 in discounted terms. The final setting is
**γ = 1.0 (undiscounted episodic)** — delaying a terminal gains exactly
nothing, and the shaping telescopes exactly.

**Null action = null actuation.** The original `(a+1)/2` throttle decode put
the newborn policy at 50 % throttle (TWR ≈ 2.6) — born as an unstabilised
inverted pendulum, tumbling in every rollout. Actions ≤ 0 now mean engines
OFF; freefall (aerodynamically stable) is the policy's origin and thrust is
opt-in.

**The vertical shaping term tracks a descent profile, not |vy|.** Rewarding
|vy|→0 unconditionally paid the policy to thrust into an ascent: the
transient reward lands inside GAE's credit window while the doom 400 steps
later does not. Φ now penalises `|vy − vy_ref(alt)|` with
`vy_ref = −clip(0.06·alt_above, 2, 90)` — ascending is immediately
expensive, freefalling past the profile is too, and the funnel points at
the catch. Φ also carries tilt (W=3/rad) and angular-rate (W=3/(rad/s))
terms — the earliest anti-tumble signals.

### The potential Φ(s)

`Φ` is higher (less negative) the closer the vehicle is to a catchable state:

```
Φ(s) = −( W_POS·‖r − r_target‖             # distance to the catch point
        + W_VSPEED·|v_y − v_y,ref|          # vertical speed vs a descent profile
        + W_HSPEED·‖(v_x, v_z)‖             # horizontal speed
        + W_TILT·tilt_from_upright          # attitude error
        + W_OMEGA·‖ω‖ )                     # angular rate — earliest anti-tumble
```

The vertical term tracks a **reference descent profile**, not `|v_y|`:
`v_y,ref = −clip(0.06·alt_above_target, 2, 90)` m/s — rewarding `|v_y|→0`
unconditionally paid the policy to thrust into an ascent (SLS-29 diagnostic).

Defaults (`env.py`): `W_POS=5e-3` /m, `W_VSPEED=2.5e-2` /(m/s),
`W_HSPEED=2.5e-2` /(m/s), `W_TILT=3.0` /rad, `W_OMEGA=3.0` /(rad/s).
**Scale matters** (SLS-29
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

### Propellant penalty (SLS-80 / ADR-023)

`−W_FUEL·kg_burned` per step (default `W_FUEL=3e-5` /kg) mirrors the MPC's
min-fuel objective (`services/mpc`: minimise Σσ·dt), so a fuel-optimal policy
coasts on the fins and burns only for the short late landing burn instead of a
continuous centre-ring coast burn. Sized like Φ: a wasteful ~231 t episode costs
~7 reward — commensurate with the shaping, far below the ±100 terminal, so it
never overrides the catch signal. **Guards future RL/fine-tune runs only** — the
*shipped* policy is behaviour-cloned from the scripted teacher (`cascade.py`) and
is unaffected until re-cloned (SLS-89 / ADR-023).

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
