# ADR-010: Terminal-dock control laws for dispersion robustness

- **Status:** Accepted
- **Date:** 2026-07-05
- **Tickets:** SLS-47 (closes the M5 catch gate); extends ADR-009
- **Findings lineage:** 6-round probe campaign on jittered ICs (this ticket)

## Context

ADR-009's coast+burn guidance flew the full profile into the chopstick
slot on the clean scenario, but ±5 % Monte-Carlo IC jitter gave 0 %
catch (4.4 km median). An instrumented per-seed probe showed the
kilometres were gone before the last 100 m — the coast trim and burn
divert absorb the dispersion fine — and every miss was one of a small
set of terminal-phase failures. The 6-DOF planner ADR-009 anticipated
was NOT needed; five control-law fixes were.

## Decision

Terminal tracking and dock laws in `MPCController` (all client-side; the
SOCP service is untouched):

1. **Gravity cap** (burn): when the vehicle already descends slower than
   the plan at its altitude, commanded vertical acceleration is capped
   just below gravity. A min-fuel plan's tail is bang-bang max braking;
   the altitude-indexed lookup mapped a too-slow vehicle onto exactly
   those nodes and drove vy through zero into a full-thrust climb
   (measured −164 → +74 m/s at 800 m, re-ascending kilometres).
2. **Float pulses** (burn + dock): once the stack is light, the 3-engine
   thrust floor exceeds weight and lit engines can only climb (measured
   runaway to 100+ km in the dock). Descent is delivered by engines-off
   pulses with vy hysteresis; plan expiry is altitude-gated so pulses
   don't strand the clock.
3. **Slew-limited, two-regime dock tilt**: the raw lateral PD reverses
   its command faster than the attitude loop's seconds-scale lag —
   rail-to-rail attitude swings and a ±5 m/s lateral limit cycle that
   position-loop tuning (soft 0.05/0.6 or stiff 0.15/0.9) cannot remove.
   The tilt *setpoint* is rate-limited below the lag; a far regime
   (0.12 rad, 0.06 rad/s) kills burn-handoff momentum, a precision
   regime (0.03 rad, 0.02 rad/s) holds the residual wobble under the
   2 m/s envelope.
4. **Approach corridor bias**: the tower truss box reaches x = +6 and
   the slot centre is x = 8.5 — a 2.5 m corridor; the capture box ends
   at x = 12. The dock aims x + 1.25 m, splitting the wander margin
   between striking the truss and overflying the capture box (both
   observed; 2.0 m biased too far out).
5. **Dock-only rate damping** (2.5 vs the flight 1.2): float-pulse
   thrust transients ring the attitude to ±3.0–3.4°, sampled against the
   3° envelope at capture entry — a per-seed coin flip until damped.

## Consequences

- **Positive:** catch rate on the jittered bench goes 0 % → ~75 %
  (probe, wind 0); no PID-fallback flights among probe seeds; all fixes
  are constants + small laws in one file, unit-tested as pure functions.
- **Negative:** the dock can loiter (hold-until-centred) for tens of
  seconds, burning propellant a real booster would not have — the sim's
  10 % fuel fraction absorbs it, but fuel medians rise; engines-off
  pulses at ~1 Hz have no relight cost in the sim, which is generous to
  us (real Raptors cannot duty-cycle).
- **Neutral / follow-up:** the wind sweep inherits these laws unchanged
  (steady wind adds a tilt bias well inside the precision authority);
  the impact predictor still assumes zero wind — feedback absorbs the
  bias, but a wind-estimate feed-forward is the natural next increment
  if the sweep rows lag.

## Alternatives considered

- **6-DOF attitude-aware SCvx planning** (ADR-009's proposed next step)
  — rejected: probe data showed burn-phase divert precision was never
  the binding constraint; the failures were terminal-phase control laws.
  Solver cost (p50 ~1 s linear already) would also have doubled down on
  R3.
- **Softening dock attitude PID gains** instead of rate damping — tested
  (round 5): loosened setpoint tracking, vehicle drifted into the tower;
  0 catches.
- **Stiffening the dock lateral PD** to out-muscle the limit cycle —
  tested (round 2): same-amplitude cycle at the same lag crossover.
- **Hover-hold via throttle below the floor** — physically unavailable:
  the plant clamps lit engines up to 40 %; the floor exceeding weight is
  the real vehicle's constraint too (its answer, and ours, is timing —
  plus our pulses where the sim permits them).
