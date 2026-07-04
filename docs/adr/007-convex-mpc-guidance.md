# ADR-007: Convex MPC guidance — 3-DOF lossless-convex SOCP outer loop + PID inner loop

- **Status:** Accepted
- **Date:** 2026-07-04
- **Tickets:** SLS-25 (formulation), SLS-26 (service), SLS-27 (SCvx upgrade + benchmarks + WASM ADR)

## Context

ADR-006 shipped a cascaded PID that misses BoosterDescentCalm by ~20 km
lateral: the suicide-burn profile cannot trade fuel against the 300 m/s
initial lateral velocity from (0, 65 km, 50 km). The M5 milestone's job is
a guidance layer that plans the whole descent as a trajectory optimization
problem, re-planned in flight — the "MPC works where PID didn't" headline.

The literature baseline is lossless convexification of powered-descent
guidance (Açıkmese & Blackmore, IEEE TCST 2013; flight-proven as G-FOLD):
the nonconvex thrust lower-bound + pointing constraints of the 3-DOF
soft-landing problem admit an exact convex (SOCP) relaxation. The 6-DOF
extension (Szmuk & Açıkmese 2018) needs successive convexification (SCvx)
— an outer linearize-and-resolve loop without global convergence
guarantees, at roughly 30× the solve cost.

Constraints from our plant (see Confluence KB + `packages/physics`):

- Only the 3 centre Raptors gimbal, at ±15°, so thrust-pointing limits
  matter more than magnitude limits.
- Throttle floor 0.4 per engine — a hard nonconvex bound that lossless
  convexification handles exactly (that is the whole point).
- The catch slot centre sits at ≈ (8.5, 91, 0): between the closed-pose
  chopstick hardpoints (x ∈ [5, 12], z = ∓5) on the +x side of the tower.
  The tower body occupies x ∈ [−6, 6], z ∈ [−6, 6] up to y = 146 — the
  structure rises 55 m ABOVE the catch height, so "descend vertically onto
  the target" is not tower-safe on the −x side.
- The scenario's nominal `targetPosition` is (0, 91, 0) — the tower
  centreline, not the physical slot. MPC targets the slot centre; the
  catch detector fires on capture-volume entry either way.

## Decision

**Two-layer architecture: a 3-DOF lossless-convex SOCP guidance loop
(re-planned at 1 Hz) feeding the existing cascaded-PID inner loop as a
trajectory tracker.**

Formulation (per re-plan, following Açıkmese & Blackmore 2013):

- **State:** position r(t), velocity v(t) ∈ R³; log-mass z(t) = ln m(t).
- **Control:** thrust acceleration u(t) ∈ R³ plus slack σ(t) with
  ‖u‖ ≤ σ; mass-normalized thrust bounds linearized around the reference
  mass profile z̄(t) (standard change of variables; keeps ρ₁ ≤ T ≤ ρ₂
  convex including the throttle floor).
- **Dynamics:** r̈ = u + g + a_drag(v̄, ρ(h̄)) with drag linearized about
  the previous plan's trajectory (Cd(M) from SLS-45 enters through this
  term). Discretized at N = 60 nodes; final time via golden-section search
  on t_f outside the SOCP.
- **Glide slope:** ‖r_xz − r_f,xz‖ ≤ tan(15°) · (r_y − 91) — a 15°-from-
  vertical cone with apex at the slot centre r_f = (8.5, 91, 0).
- **Tower keep-out:** linear half-space x ≥ 12 enforced for all nodes with
  r_y < 250, releasing to the glide cone inside the final approach. Convex,
  conservative (booster radius 4.5 m + margin), and cheap.
- **Thrust pointing:** u_y ≥ σ·cos(15°), matching the centre-engine gimbal
  cone.
- **Terminal box:** matches the catch envelope — ‖r(t_f) − r_f‖ ≤ 10,
  |v_y(t_f)| ≤ 5, ‖v_xz(t_f)‖ ≤ 2.
- **Objective:** minimum fuel (∑ σ_k Δt); matches operational reality and
  makes the fuel-margin comparison against PID meaningful.
- **Inner loop:** cascaded PID (ADR-006 gains) tracks (r*, v*) and the
  attitude implied by u*/‖u*‖, at 250 Hz between 1 Hz re-plans.

Solver chain: Python FastAPI service with CVXPY + Clarabel (SLS-26) —
Clarabel is CVXPY's default open-source conic solver and handles the SOCP
directly. Browser/WASM execution is explicitly deferred to SLS-27's ADR
(candidates: Clarabel.rs → wasm32, ECOS emcc build, or server-only with
client replay).

## Alternatives considered

- **6-DOF SCvx from day one** (Szmuk & Açıkmese 2018): honest attitude
  dynamics in the plan, but ~30× solve cost, an outer iteration loop with
  no convergence guarantee, and a much bigger service surface. Deferred to
  SLS-27 as an upgrade path once the 3-DOF baseline and benchmark harness
  exist.
- **Linear MPC without cone constraints:** fast but abandons the throttle
  floor and pointing/glide constraints — exactly the constraints the
  headline comparison is meant to showcase.
- **Offline precomputed trajectory + tracker only:** no re-planning means
  no wind rejection; the live re-plan is SLS-26's core feature.
- **Symmetric glide cone about the tower centreline (0, 91, 0):** rejected
  — the tower rises 55 m above the catch height ~1.5 m laterally from that
  axis; no usable cone exists there. Targeting the physical slot centre
  with a +x keep-out is both convex and honest about the geometry.

## Consequences

- SLS-26 implements exactly this formulation; deviations go back into this
  ADR.
- The numpy↔TS parity concern (SLS-28 / R1) gets a new member: the drag
  linearization must consume the same Cd(M) table as `packages/physics`.
  Keep the table in one exportable place.
- The 1 Hz re-plan cadence and N = 60 are starting points; the benchmark
  suite (SLS-27) owns tuning them.
- Known modelling gap carried forward: aerodynamic drag is applied at full
  Cd(M) during burns, but supersonic retropropulsion largely cancels
  aerodynamic drag (see `docs/reference/dynamics.md`). Conservative for
  guidance; revisit with the SLS-27 benchmarks.

## Sources

- Açıkmese, B., Blackmore, L. — "Lossless Convexification of Nonconvex
  Control Bound and Pointing Constraints of the Soft Landing Optimal
  Control Problem", IEEE TCST 2013. http://www.larsblackmore.com/iee_tcst13.pdf
- Blackmore, L. — "Autonomous Precision Landing of Space Rockets", NAE
  The Bridge, 2016. http://larsblackmore.com/nae_bridge_2016.pdf
- Szmuk, M., Açıkmese, B. — "Successive Convexification for 6-DoF Mars
  Rocket Powered Landing with Free-Final-Time", AIAA SciTech 2018.
  https://arxiv.org/abs/1802.03827
- Malyuta, D., et al. — "Convex Optimization for Guidance and Control of
  Vehicular Systems" (survey), 2023. https://arxiv.org/pdf/2311.05115
- Glide-slope constraint form: NASA NTRS 20160012101.
- CVXPY default-solver transition to Clarabel:
  https://github.com/cvxpy/cvxpy/discussions/2178
