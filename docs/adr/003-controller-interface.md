# ADR-003: Controller interface

- **Status:** Accepted
- **Date:** 2026-05-23
- **Tickets:** SLS-5

## Context

We will implement at least four kinds of controllers — manual joystick, cascaded PID, MPC (Python service), and RL (ONNX in-browser). They all need to drive the same physics plant. Without a shared interface, every new controller becomes a fresh rewrite of the simulation loop.

## Decision

All controllers implement a single TypeScript interface, parameterised by the plant's input type:

```typescript
interface Controller<TInput> {
  readonly name: string;
  init(config: unknown): Promise<void> | void;
  step(state: Readonly<RigidBodyState>, dt: number): TInput;
  reset?(): void;
}
```

- Each **plant** (booster, ship) defines its own `ControlInput` type — the exact shape (number of gimballed main engines, count and direction of RCS thrusters, grid-fin deflections) is the plant's concern, not the controller's, and gets defined in the plant ticket (SLS-10). The `Controller<TInput>` parameter makes the type system enforce plant-compatibility.
- Controllers receive the **full** `RigidBodyState`. Each controller is responsible for its own preprocessing — normalisation for RL, sensor-noise observer for PID, etc.
- Controllers own their internal state (PID integral, MPC warm-start, RL hidden state). The sim loop is stateless with respect to controller internals.

## Consequences

- **Positive:** Swapping controllers is a one-line change. Monte-Carlo comparison across controllers (SLS-24) reduces to a loop over implementations.
- **Positive:** `Readonly<RigidBodyState>` makes accidental mutation a type error; physics integrity is enforced at the boundary.
- **Negative:** `init` is async because the MPC client must handshake with the Python service and the RL controller must load ONNX weights. Async leaks into controller instantiation — accepted.
- **Negative:** Sharing the full state (rather than a controller-specific view) means observability changes — e.g. simulating sensor noise — need to wrap either the state or the controller, not change this interface.

## Alternatives considered

- **Event-driven controllers (subscribe to state, emit inputs).** Rejected — fixed-timestep simulation wants synchronous step semantics.
- **Controllers receive a controller-specific view of state.** Rejected as premature — we don't yet know which views matter for which controllers, and YAGNI applies.
- **One mega-`ControlInput` type covering all plants.** Rejected — it would let controllers produce inputs for actuators the current plant doesn't have, which is exactly the category error we want the type system to catch.
