# MPC guidance

The MPC controller replaces PID's hand-tuned outer loop with **optimisation**: at
each guidance update it solves for a fuel-/error-optimal trajectory to the catch
point, subject to the vehicle's thrust and attitude limits, and hands the result
to a PID inner loop to fly.

## How it's structured

- **Outer loop — convex guidance.** A 3-DOF translational model of the descent is
  posed as a second-order cone program (SOCP) via lossless convexification of the
  thrust constraints, and solved for an optimal acceleration/thrust profile. This
  is the powered-descent-guidance formulation, adapted to the catch. See
  [ADR-007](/adr/007-convex-mpc-guidance).
- **Ignition planning.** The booster coasts, then lights engines for a terminal
  burn; *when* to ignite is itself planned (a coast-then-burn schedule) rather
  than fixed — [ADR-009](/adr/009-coast-burn-guidance).
- **Inner loop — PID.** The planned trajectory is tracked by the same
  [cascaded PID](/controllers/pid) attitude loop that flies the PID controller.

## Running it: a service

The convex solve is heavier than a per-frame browser budget allows, so MPC runs
as a **guidance service** (`services/mpc`) that the app calls over HTTP. A
browser-side WASM port was scoped in [ADR-008](/adr/008-mpc-wasm-port) but is not
what the public demo runs.

::: warning On the hosted demo, MPC is degraded
The static GitHub Pages demo has no guidance service, so selecting **MPC** there
falls back to PID and shows a banner ([ADR-011](/adr/011-static-demo-hosting)).
To exercise the real MPC, run the app locally with the `services/mpc` service up
(see the repository README).
:::

## Try it

Run the MPC service locally, then pick **MPC** from the controller dropdown. With
no service reachable, the app flies PID and tells you so.
