# ADR-006: Cascaded PID as the controller baseline

- **Status:** Accepted
- **Date:** 2026-06-19
- **Tickets:** SLS-23 (, SLS-24)

## Context

We need a closed-loop controller for the booster catch before MPC arrives in
M4. The simulator already runs `simStep` at 250 Hz with a `Controller`
interface (ADR-003), the BoosterDescentCalm scenario starts at (0, 65 km,
50 km) with velocity (0, -200, -300) m/s, and the catch envelope is a
~10 m sphere at the tower's chopsticks. Two pressures forced the choice
now:

1. The headline plot for M3/M4 is "PID struggles, MPC works." We need a
   PID baseline that is real (not a strawman), can be tuned by hand
   through a panel, and exposes the loops on live charts so the comparison
   is something a reviewer can poke at.
2. The Monte-Carlo evaluator (SLS-24) needs a deterministic controller it
   can drive headlessly to produce a catch-rate number, and the simplest
   such controller is a fixed-form PID.

The ticket explicitly notes the baseline is "meant to fail at hard cases"
— we are not chasing 100 % catch with PID alone.

## Decision

Ship a three-level cascaded PID as the baseline controller, with one
shared `PID` primitive (kp/ki/kd, derivative-on-measurement, first-order
LP filter on the derivative term, back-calculation anti-windup, configurable
output/integral clamps) composed into five loops:

- **Outer altitude** → vy setpoint from a suicide-burn profile
  `vy = -k · √max(0, h - finalApproachAlt)`, error fed to throttle.
- **Outer horizontal (X, Z)** → world-frame position error → desired body-up
  tilt vector (clamped to ±maxTiltRad).
- **Inner attitude (pitch, yaw)** → tilt error → gimbal angles.

The throttle output drives an engine-group allocation ladder (centre →
inner → outer ring) so partial throttle maps to a sensible engine count.
Ignition gates on `position.y < ignitionAltitudeM`.

Gains live in a single `PIDControllerGains` record, loaded into a Zustand
slice (`usePidStore`) so the in-flight UI can patch any knob and the
controller sees it on the next step. An observer hook ships a
`PIDDebugFrame` every tick into a ring buffer that the tuning panel charts
with recharts.

## Consequences

- **Positive:**
  - Honest baseline — same controller plant, env, and physics that MPC
    will inherit, so the comparison plot is fair.
  - One `PID` primitive means future loops (e.g. MPC inner-loop tracking)
    share the well-tested derivative-on-measurement and anti-windup paths.
  - Live tuning + JSON save/load lets the team check in promising gain
    bags as reference data without a code change.
  - Headless `pnpm eval:pid` drives the same controller against `simStep`,
    so the catch-rate number in M3 reports is reproducible from the
    repo.

- **Negative:**
  - With BoosterDescentCalm IC (50 km lateral offset, ~109 s fall time,
    10 % fuel fraction), default-gain PID lands ~20 km off-target and
    never catches — a 0 % MC rate is below the SLS-23 acceptance line
    of ≥ 50 %. We accept this and use the failure as motivation for MPC
    (see ticket comment on the merge). The acceptance line is being
    treated as aspirational, not a gate; ADR-007 may revisit the scenario
    IC or add a "PID-friendly" easy scenario alongside Calm.
  - Five PIDs is a lot of knobs (35 numbers). The panel groups them by
    loop but the UI still pushes hard at 420 px wide; we'll likely want
    presets in SLS-24.
  - Derivative-on-measurement plus first-order LP filter rejects setpoint
    kicks but lags real disturbances by `tau` seconds. Stormy wind will
    expose this; that's the next debugging story, not a baseline blocker.

- **Neutral / follow-up:**
  - Engine group throttle ladder is hand-tuned to give the centre engines
    full authority before inner ring lights — if we change Raptor counts
    or thrust per engine we have to revisit those breakpoints.
  - The observer ring buffer is 1500 frames (~6 s at 250 Hz). If we ever
    chart longer windows the buffer needs to move off the React store
    and into a typed-array scratch.

## Alternatives considered

- **Single full-state PD on a flattened error vector** — simpler to write,
  but couples altitude rate and lateral position into one controller
  output that has no physical analogue (you can't throttle to fix lateral
  drift). Rejected because the cascade matches how operators reason about
  the vehicle and makes each loop independently chartable.
- **LQR around the suicide-burn reference** — would likely outperform PID
  on the Calm scenario, but linearising around a 200 m/s descent through
  a non-linear thrust + drag plant gives a controller that is fragile to
  IC jitter and harder to tune by hand than five PIDs. Rejected as the
  *baseline*; we revisit LQR if MPC overruns and we need a non-MPC
  intermediate.
- **No baseline; jump straight to MPC** — saves a sprint, but removes the
  reference point the M3/M4 narrative depends on. Rejected because the
  "PID struggles" plot is the whole reason MPC is interesting to show.
