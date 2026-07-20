# ADR-023: Booster fuel budget + descent-profile realism (the continuous-burn root cause)

- **Status:** Accepted
- **Date:** 2026-07-20
- **Tickets:** SLS-80 (root cause + guardrails, this ADR), SLS-89 (the behaviour-changing retrain). Relates ADR-009 (coast-burn guidance), ADR-014/015 (PPO + BC campaign), SLS-78 (zero-fuel gating), SLS-66 (headline floor).

## Context

Owner observation (SLS-80): the shipped RL policy keeps the booster's **3 centre
engines lit through the entire descent** — unphysical, and it burns ~231 t of
propellant on a catch (bench `medFuel`).

**The real vehicle** coasts. Super Heavy re-enters on aerodynamics + **grid
fins**, engines off, then lights the **central 13 engines at ~1 km** for a short
landing burn, drops to the **central 3** near the pad, and shuts off at the
catch — retaining only **~7 % propellant reserve** (SpaceX Flight 5, Oct 2024;
sources in `docs/reference/dynamics.md`). So the realistic profile is: long
unpowered aero descent → short, late, high-authority landing burn on a bounded
reserve.

**Current fuel budget** (`presets/super-heavy.ts`, `scenarios.ts`): dry mass
200 t; full tank ≈ 3 274 t; the `booster-descent-*` scenarios start at
`INITIAL_FUEL_FRACTION = 0.1` ⇒ **327.4 t** loaded. SLS-78's zero-fuel gating is
correctly in place (thrust → 0 at empty, both the TS core and the numpy port).

### Root cause — NOT what the ticket first assumed

The ticket hypothesised a free-fuel **RL reward exploit** and/or an oversized
**fuel budget**. The investigation found neither is the cause:

- **The shipped policy is not RL-trained.** It is **behaviour-cloned** (imitation
  learning) from a **scripted teacher** — `services/rl/src/rl/cascade.py` — which
  *deliberately* holds the centre ring at `coast_throttle = 0.45` for the **whole
  coast**, with the reason in the code: *"engines-off coast tumbles; a tumbled
  landing burn fires sideways."* The BC clone faithfully reproduced it. 3 centre
  Raptors at 0.45 over a multi-minute fall ≈ the entire ~231 t burned.
- Therefore **changing the RL reward does not change the deployed policy** (BC,
  not RL never touched it), and **changing the fuel budget does not change the
  policy weights** either — it is a permissive *enabler* (327 t loaded, 231 t
  burned, never runs dry), not the cause. Shrinking the budget *before* fixing
  the teacher would just trip `fuel_exhausted`.
- Only **fixing the teacher's coast + re-cloning** changes the deployed
  behaviour.

**The hard part:** the continuous burn may be **load-bearing for the catch**, not
merely wasteful. The realistic fix (coast on fins, burn late) is exactly what the
**MPC already does — and the MPC catches 0 %** in this sim, because attitude
tracking through a low-dynamic-pressure fins-only coast is where it fails. And
the deployed policy **is** the M6 headline result (87/87/90, guarded by the
SLS-66 CI floor). So a naïve de-burn risks tanking the headline.

## Decision

Split the work by risk. **This ticket (SLS-80) ships the design + guardrails and
leaves the deployed M6 policy untouched; the behaviour change is deferred to
SLS-89** (a training campaign, gated on not regressing the catch rate).

1. **Document the realistic target** (this ADR + `docs/reference/dynamics.md`):
   coast on grid fins → short late central-engine landing burn → bounded reserve.
   This already matches ADR-009 (the MPC's coast+burn + min-fuel objective +
   reserve constraint) — the MPC is the reference profile.

2. **Reward guardrail now (SLS-80):** add a propellant penalty to the RL reward —
   `reward -= W_FUEL · kg_burned`, `W_FUEL = 3e-5` (`services/rl/src/rl/env.py`).
   It mirrors the MPC's min-fuel objective, so any *future* RL run can't re-learn
   a free continuous burn. Sized like the shaping Φ (a wasteful ~231 t episode
   costs ~7 reward — commensurate with the shaping, far below the ±100 terminal),
   so it never overrides the catch/miss signal. **This is inert for the shipped
   BC policy** — it only bites a future RL/fine-tune path.

3. **Defer the behaviour change (SLS-89):** rewrite the teacher's coast to take
   attitude authority from the **fins** + a short pre-ignition centre align
   window (like the MPC's `IGNITION_ALIGN_S`), then re-collect demos → re-run BC →
   re-export. **Do not swap the shipped policy unless the re-cloned one holds the
   catch rate.** Keep the current 87/87/90 policy as the headline until then.

4. **Leave the fuel budget (10 % = 327 t) as-is for now.** It's a plausible ~10 %
   reserve and only a permissive enabler; revisit it *after* the teacher fix so it
   doesn't cause `fuel_exhausted` under the current continuous burn.

## Red-team vs the acceptance gate

*Acceptance:* engines coast then burn late, always-on gone, without tanking the
catch rate.

- **Can this session meet it?** No — and it shouldn't try. The behaviour lives in
  a *trained artifact*; changing it needs a re-clone whose outcome is genuinely
  uncertain (fins-only coast attitude control is unproven for catching here — the
  MPC gets 0 %). Committing to swap the M6 policy now would gamble the headline on
  an unrun campaign. SLS-80 therefore delivers the *diagnosis + guardrails +
  documented target*; SLS-89 runs the campaign and **must verify the catch rate
  survives before any swap** — or record the null result (fins-only coast can't
  hold the catch in this aero model), which is itself a valuable finding for the
  aero/control roadmap.

## Consequences

- **Good:** the realism gap is correctly diagnosed and documented; the sourced
  fuel budget + descent profile are recorded; future training is guarded against
  the free-burn objective; the M6 headline is untouched (zero R13 risk this
  session).
- **Cost:** the visible behaviour (continuous centre burn) is unchanged until
  SLS-89 lands — the deployed policy still burns through the coast.

## Alternatives considered

- **Shrink the fuel budget to force discipline** — rejected as the primary lever:
  it doesn't touch the BC policy's weights, and under the current continuous burn
  it would just exhaust the tank. Revisit post-teacher-fix.
- **Only fix the RL reward** — rejected as sufficient: the shipped policy is BC,
  not RL, so the reward never gated it. Kept as a *guardrail* for future RL only.
- **Fix the teacher + re-clone this session** — rejected as too risky for one
  session: headline-affecting, uncertain outcome, needs a proper campaign
  (SLS-51 lessons). Deferred to SLS-89.
