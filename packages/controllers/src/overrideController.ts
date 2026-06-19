/**
 * Multiplexes a primary controller with a manual override that takes
 * over for a short window whenever a manual input arrives. Used by the
 * SLS-24 controller switcher so the player can grab the stick mid-flight
 * during an auto-fly run, then release it back to the controller.
 *
 * Override is gated by `isManualActive()` (any movement key held or any
 * gamepad axis non-zero) — when that fires we stamp `overrideUntilT` to
 * `world.t + overrideDurationS`. While `world.t < overrideUntilT`, the
 * manual controller drives; otherwise the primary controller drives.
 * "Hard takeover" mode pins the override forever once triggered until
 * the user toggles the mode off.
 */

import type { ControlInput, World } from "@starship-catch-sim/physics";

import type { Controller } from "./types.js";

export type OverrideMode = "temporary" | "hard";

export type OverrideControllerOpts = {
  primary: Controller;
  manual: Controller;
  /** Returns true when a manual key / axis is currently engaged. */
  isManualActive: () => boolean;
  /** Seconds of override after each manual nudge in "temporary" mode. */
  overrideDurationS: number;
  /** Source of truth for mode — read every step so the toggle is live. */
  getMode: () => OverrideMode;
  /** Optional observer fired when override starts / ends, useful for the HUD. */
  onTransition?: (active: boolean) => void;
};

export class OverrideController implements Controller {
  private overrideUntilT = -Infinity;
  private wasOverride = false;
  private hardPinned = false;
  private readonly opts: OverrideControllerOpts;

  constructor(opts: OverrideControllerOpts) {
    this.opts = opts;
  }

  step(world: World, dt: number): ControlInput {
    const mode = this.opts.getMode();
    const manualActive = this.opts.isManualActive();
    if (manualActive) {
      if (mode === "hard") {
        this.hardPinned = true;
      } else {
        this.overrideUntilT = world.t + this.opts.overrideDurationS;
      }
    }
    const isOverride =
      this.hardPinned || (mode === "temporary" && world.t < this.overrideUntilT);
    if (isOverride !== this.wasOverride) {
      this.wasOverride = isOverride;
      this.opts.onTransition?.(isOverride);
    }
    return isOverride
      ? this.opts.manual.step(world, dt)
      : this.opts.primary.step(world, dt);
  }

  /** Release any pinned override (used when toggling out of hard mode). */
  release(): void {
    this.hardPinned = false;
    this.overrideUntilT = -Infinity;
  }
}
