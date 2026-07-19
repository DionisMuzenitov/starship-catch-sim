# Write your own controller

A controller is **one method**. Implement it, and your agent flies the same
booster, in the same physics, as the built-in PID / MPC / RL controllers.

## The interface

```ts
import type { ControlInput, World } from "@starship-catch-sim/physics";

export interface Controller {
  /** Produce a control vector for the given world snapshot and step duration. */
  step(world: World, dt: number): ControlInput;
}
```

`step` is called once per simulation tick. You get a read-only `World` (the
current physical state) and `dt` (the step in seconds), and you return a
`ControlInput`.

### What you read: `World`

```ts
type World = {
  readonly rigidBody: RigidBodyState; // position, velocity, attitude (quat), angularVelocity
  readonly mass: MassProperties;      // current mass + propellant remaining
  readonly engineStates: readonly EngineState[];
  readonly surfaceStates: readonly SurfaceState[];
  readonly t: number;                 // seconds since scenario start
};
```

`world.rigidBody.position` is a `Vec3` in metres (`y` is altitude);
`world.rigidBody.velocity` is m/s; `world.rigidBody.attitude` is a quaternion.

### What you return: `ControlInput`

```ts
type ControlInput = {
  readonly engineGroups: EngineGroupBag<number>;  // throttle target per group, [0, 1]
  readonly enginesOn: EngineGroupBag<boolean>;    // ignition per group
  readonly gimbalPitch: number;                   // rad
  readonly gimbalYaw: number;                     // rad
  readonly fins: readonly number[];               // per-fin deflection (rad)
  readonly flaps: readonly number[];              // per-flap deflection (rad)
};
// EngineGroupBag<T> = { centre: T; inner: T; outer: T; ship: T }
```

Start from `neutralControl(finCount, flapCount)` (a zero-everything input of the
right shape) and spread in what you want to change.

## A runnable example

This is a complete, ~30-line controller plus a headless loop that flies it for a
few ticks against a built-in scenario — the same pattern the app and the
[benchmark harness](/benchmarks) use.

```ts
import {
  BoosterDescentStandard,
  neutralControl,
  simStep,
  type ControlInput,
  type World,
} from "@starship-catch-sim/physics";
import type { Controller } from "@starship-catch-sim/controllers";

// A trivial controller: light every booster engine at 80% throttle, no steering.
// Replace `step` with your guidance law.
class FullBurnController implements Controller {
  constructor(
    private readonly finCount: number,
    private readonly flapCount: number,
  ) {}

  step(_world: World, _dt: number): ControlInput {
    return {
      ...neutralControl(this.finCount, this.flapCount),
      engineGroups: { centre: 0.8, inner: 0.8, outer: 0.8, ship: 0 },
      enginesOn: { centre: true, inner: true, outer: true, ship: false },
    };
  }
}

const scenario = BoosterDescentStandard;
const fins = scenario.vehicle.surfaces.filter((s) => s.kind === "grid_fin").length;
const flaps = scenario.vehicle.surfaces.filter((s) => s.kind === "flap").length;
const controller = new FullBurnController(fins, flaps);

let world = scenario.initialWorld;
const dt = 1 / 60;
for (let i = 0; i < 10; i++) {
  const control = controller.step(world, dt);
  world = simStep(world, scenario.vehicle, control, dt, scenario.env);
  console.log(`t=${world.t.toFixed(2)}s  altitude=${world.rigidBody.position.y.toFixed(1)} m`);
}
```

Run it from a clone of the repo (the packages are workspace-internal, so this
runs against the local source, not a published npm package):

```bash
pnpm install
pnpm tsx my-controller.ts   # tsx runs TypeScript directly
```

::: tip Scoring a catch
To grade a run, compare the terminal `world` against the scenario's catch
envelope with `evaluateCatch(world, scenario.targetCatch)` — it returns
`{ caught, reason }`. That envelope (position ≤ 10 m, |vᵧ| ≤ 5 m/s, v_h ≤ 2 m/s,
tilt ≤ 3°, ω ≤ 5°/s) is the single success gate every controller is measured
against.
:::

## Wiring it into the app

The interface is fixed by [ADR-003](/adr/003-controller-interface). The built-in
controllers (`ManualController`, `PidController`, `MpcController`,
`RlController`) all live in `packages/controllers` and implement this same
`Controller` — read any of them for a fuller worked example, or the
[Controllers overview](/controllers/) for how they compose.
