# Controllers

Every agent that flies the booster — you, a PID loop, the MPC service, or the
trained RL policy — implements the same one-method interface and is dropped into
the identical simulation loop. Switching between them in the app re-seeds the
run with the new controller; nothing else changes.

## The interface

```ts
import type { ControlInput, World } from "@starship-catch-sim/physics";

export interface Controller {
  /** Produce a control vector for the given world snapshot and step duration. */
  step(world: World, dt: number): ControlInput;
}
```

A `ControlInput` is per-engine-group throttle + ignition, gimbal pitch/yaw, and
per-surface fin/flap deflections. See **[Write your own controller](/api/controllers)**
for the full type and a runnable example. The interface itself is fixed by
[ADR-003](/adr/003-controller-interface).

## The four controllers

| Controller | What it is | Where it's decided |
| --- | --- | --- |
| **Manual** | Direct keyboard / mouse stick input. | — |
| **[PID](/controllers/pid)** | Cascaded PID: outer position/velocity → inner attitude → gimbal + throttle. | [ADR-006](/adr/006-cascaded-pid-baseline), [ADR-015](/adr/015-attitude-inner-loop-and-bc-campaign) |
| **[MPC](/controllers/mpc)** | Convex (SOCP) guidance outer loop over a 3-DOF model, PID inner loop; runs as a service. | [ADR-007](/adr/007-convex-mpc-guidance), [ADR-009](/adr/009-coast-burn-guidance) |
| **RL** | A neural-network policy trained with PPO against the catch envelope. | [ADR-013](/adr/013-rl-numpy-port-and-parity)–[ADR-016](/adr/016-ts-policy-runtime) |

## Override: take the stick mid-flight

While an auto-controller flies, any manual key hands control to you:

- **temp** — you have it for ~2 s, then the auto-controller resumes.
- **hard** — you keep it for the rest of the run.

This is a separate composed controller, so it works identically over PID, MPC,
or RL.

## The RL policy

The reinforcement-learning controller is the headline result — a policy trained
entirely in a numpy port of this exact physics (single-sourced constants,
TS ↔ Python [parity-tested](/adr/013-rl-numpy-port-and-parity)) and then run in
the browser as pure TypeScript from JSON weights (no ONNX runtime —
[ADR-016](/adr/016-ts-policy-runtime)). Its reward function — potential-based
shaping toward the catch point plus a sparse terminal bonus — is documented in
full on the **[RL reward design](/rl-reward)** page.
