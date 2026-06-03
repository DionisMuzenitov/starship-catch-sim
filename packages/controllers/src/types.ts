/**
 * The `Controller` interface that every flight strategy implements —
 * manual input (this ticket), PID (SLS-23/24), MPC (SLS-25–27), RL
 * (SLS-28–30). One signature in, one signature out.
 */

import type { ControlInput, World } from "@starship-catch-sim/physics";

export interface Controller {
  /** Produce a control vector for the given world snapshot and step duration. */
  step(world: World, dt: number): ControlInput;
}
