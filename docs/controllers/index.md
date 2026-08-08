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
| **RL** | A neural-network policy, **imitation-learned** by behaviour cloning on a scripted-cascade teacher (not RL-trained — direct PPO/SAC never caught). | [ADR-013](/adr/013-rl-numpy-port-and-parity)–[ADR-016](/adr/016-ts-policy-runtime) |

::: tip The catch is two-sided
The tower isn't a passive target. An **active catch-assist** controller nudges
the Mechazilla chopsticks laterally to meet a slightly-off booster within their
reach envelope — the way the real tower's tracking arms do
([ADR-022](/adr/022-active-catch-assist)). It cooperates with whichever booster
controller is flying, so a near-miss the booster can't fully correct can still
be caught.
:::

## Override: take the stick mid-flight

While an auto-controller flies, any manual key hands control to you:

- **temp** — you have it for ~2 s, then the auto-controller resumes.
- **hard** — you keep it for the rest of the run.

This is a separate composed controller, so it works identically over PID, MPC,
or RL.

## The RL policy

The RL-slot controller is the headline result — but it is **imitation-learned,
not RL-trained**: behaviour cloning on a scripted-cascade teacher, because direct
PPO/SAC never produced a catching policy at laptop compute
([ADR-015](/adr/015-attitude-inner-loop-and-bc-campaign)). It is trained in a
numpy port of this exact physics (single-sourced constants, TS ↔ Python
[parity-tested](/adr/013-rl-numpy-port-and-parity)) and then run in the browser as
pure TypeScript from JSON weights (no ONNX runtime —
[ADR-016](/adr/016-ts-policy-runtime)). The reward shaping from the RL training
pipeline — potential-based toward the catch point plus a sparse terminal bonus —
is documented in full on the **[RL reward design](/rl-reward)** page.
