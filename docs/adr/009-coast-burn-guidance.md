# ADR-009: Coast-phase ignition planning (coast+burn guidance)

- **Status:** Accepted
- **Date:** 2026-07-05
- **Tickets:** SLS-47 (this work); extends ADR-007
- **Findings lineage:** SLS-27 benchmarks, SLS-48 verification pass

## Context

ADR-007's burn-only guidance cannot catch: the Raptor throttle floor makes
full-horizon burn plans infeasible from high altitude, and by the time a
feasible window opens mid-fall the lateral divert budget is spent. Real
Super Heavy flies boostback → long unpowered coast → landing burn, and
G-FOLD practice solves guidance *from ignition*, choosing the ignition
time in an outer loop. SLS-47 adds that outer loop.

## Decision

**Plan from a future ignition point** (`mode: "coast+burn"`, the client's
default):

1. **Ballistic propagation** (`services/mpc/src/mpc/coast.py`): gravity +
   the same Cd(M)/ISA drag model the simulator integrates (`aero.py`),
   0.5 s semi-implicit steps, down to 2 km above the slot or 300 s.
2. **Ignition search**: candidate coast durations over that table; each
   candidate solves the existing burn SOCP from the propagated state
   (fast linear solves for the sweep, SCvx polish on the winner). Usable
   = optimal with terminal slack ≤ 5.
3. **Churn control** — the two stabilizers this design lives or dies by:
   - *Fuel tie-break, earliest wins*: fuel is nearly flat in coast time
     (gravity losses dominate), so a pure argmin re-picked ignition
     anywhere in a 60 s range on every re-plan. Among candidates within
     1.5 % fuel of the best, the earliest ignition wins.
   - *Epoch commitment via coast hints*: re-plans send the committed
     remaining coast (`coastHintS`) and the server searches only ±5 s
     around it. Measured effect: re-plans count down 21→18→15→12→9→6 s
     to one absolute ignition epoch instead of churning.

**Client tracking** (`MPCController`):

- **Coast**: engines off; tilt setpoints target the plan's *initial burn
  thrust direction* (not "vertical"); fins deployed. In the final 5 s
  (`IGNITION_ALIGN_S`) the centre engines run at their floor purely for
  gimbal authority — with engines off a coasting booster cannot reorient
  (gimbal torque needs thrust; fins are negligible above ~30 km), and an
  unaligned ignition dumped 80 % of its impulse sideways (measured:
  vz −300 → −40 m/s where the plan wanted −367). Costs ~3 t, inside the
  plan's 2 % propellant reserve.
- **Burn**: commitment semantics. Re-planning is *event-triggered* (only
  when tracking drift exceeds 600 m) — time-based 1 Hz re-plans kept
  re-anchoring the plan clock to node 0 and replaying the ignition
  impulse. The burn aborts to the PID fallback only on real divergence
  (> 4 km), never on a wall-clock staleness timer; a mid-burn answer
  proposing a fresh coast is discarded (engines are never shut down to
  resume coasting).
- Overlay: coast segment drawn as a dashed slate line, burn in emerald.

## Measured results (BoosterDescentCalm, live service)

Burn-only guidance (pre-SLS-47): 21–25 km terminal miss, no plan usable
above ~15 km altitude. Coast+burn (bench, 5 seeds × wind {0, 1, 2}×):
median miss **3.5–7.9 km vs PID's 21.6 km** — a 3–6× improvement, stable
across wind levels; best runs reach 1.7–2.2 km with vertical speed down
to −55 m/s (a controlled-landing shape). **Catch rate: 0 % — the SLS-47
≥50 % gate is NOT met.** The ignition search itself is solid (zero-slack
plans from the full 65 km state in ~1.3 s); the remaining kilometres are
burn-phase tracking drift from the 3-DOF/6-DOF attitude gap below.

## Known limitations / follow-ups

- **Ballistic-only coast**: grid-fin lateral shaping during coast is not
  planned (nonconvex); fins only damp. The plan's divert happens entirely
  in the burn.
- **3-DOF plan vs 6-DOF reality**: the SOCP assumes thrust can point
  anywhere in the 15° cone instantly; the real attitude loop takes
  seconds to swing. This gap drives the burn-phase drift that limits
  terminal precision — the natural next step if the catch gate stays
  unmet is attitude-rate-aware planning (6-DOF SCvx, ADR-007's
  documented upgrade path).
- The PD tracking gains are deliberately soft (0.05/0.3, 3 m/s² cap);
  a stiffer-tracking experiment (0.1/0.5, 6 m/s²) measured *worse*
  single-run misses — corrections fight the feedforward through the
  attitude lag.
