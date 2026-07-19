# PID controller

The PID controller is the classical-control **baseline** — the yardstick the MPC
and RL controllers are measured against. It is a cascade of loops, from slow
outer guidance to fast inner attitude:

```
position / velocity error  ──▶  desired acceleration  ──▶  desired attitude
                                                              │
                              attitude error  ──▶  gimbal + differential throttle
```

- **Outer loop** — position and vertical-velocity error produce a desired
  acceleration vector, which maps to a target tilt and a total-thrust demand.
- **Inner loop** — the attitude error (current vs. target tilt) drives gimbal
  pitch/yaw and, where available, differential throttle, to rotate the booster.

The split matters: the booster's attitude responds on a seconds timescale while
the catch tolerances are metres-scale, so a single-loop position controller
can't close the catch — the loops have to be separated and tuned independently.
That lesson (and the resulting inner-loop design) is recorded in
[ADR-015](/adr/015-attitude-inner-loop-and-bc-campaign); the baseline decision
itself is [ADR-006](/adr/006-cascaded-pid-baseline).

## Try it

In the app, pick **PID** from the controller dropdown. The **PID tuning panel**
(bottom-right) exposes the gains live, with charts — nudge a gain and watch the
descent respond.

## Where it lives

The implementation is in the `@starship-catch-sim/controllers` package
(`pidController.ts`). Because it implements the standard
[`Controller`](/controllers/) interface, it runs in the same loop as every other
controller and can be [benchmarked](/benchmarks) head-to-head.

::: info Also the MPC inner loop
The MPC controller reuses this same PID as its attitude-tracking inner loop —
the convex optimiser plans a trajectory, the PID flies it. See
[MPC](/controllers/mpc).
:::
