/**
 * Tower-side catch-assist controller (SLS-82 / ADR-021).
 *
 * The SECOND cooperating controller in the catch: the booster-side `Controller`
 * flies the vehicle to the target, and this one moves the chopstick arms to
 * intercept a booster that arrives *near* the target but slightly off —
 * widening the effective lateral catch envelope, the way the real Mechazilla
 * arms close on the incoming vehicle rather than presenting a fixed point.
 *
 * A `TowerController` emits a `TowerCommand` (arm reach / height / opening) each
 * tick; the sim lags the live `TowerState` toward it via `stepTowerState`, so
 * the arms are rate-limited and cannot teleport onto an out-of-reach booster.
 *
 * `TrackingTowerController` (the first, simplest strategy): keep the arms in the
 * closed gripping pose at the fixed catch height, and slide them laterally to
 * follow the booster's incoming horizontal position once it nears the catch —
 * clamped to the arms' physical reach, so a badly-off or too-fast booster still
 * misses.
 */

import {
  DEFAULT_ARM_HEIGHT_M,
  DEFAULT_TOWER_STATE,
  Vec3,
  chopstickCaptureVolume,
  clampArmReach,
  type TowerCommand,
  type World,
} from "@starship-catch-sim/physics";

export interface TowerController {
  /** Emit an arm command for the given world snapshot. */
  step(world: World, dt: number): TowerCommand;
}

/** Nominal catch centre with the arms home (≈ (8.5, 91, 0)). Lateral reach is
 *  measured as the offset of the live catch centre from this point. */
const NOMINAL_CENTER: Vec3 = chopstickCaptureVolume(DEFAULT_TOWER_STATE).center;

export type TrackingTowerOpts = {
  /** Start tracking once the booster descends within this height above the
   *  catch (m) — early enough that the lagged arms are in place on arrival. */
  readonly engageAboveM: number;
  /** Keep tracking until the booster falls this far below the catch (m). */
  readonly engageBelowM: number;
};

export const DEFAULT_TRACKING_TOWER_OPTS: TrackingTowerOpts = {
  engageAboveM: 120,
  engageBelowM: 20,
};

export class TrackingTowerController implements TowerController {
  private readonly opts: TrackingTowerOpts;

  constructor(opts: Partial<TrackingTowerOpts> = {}) {
    this.opts = { ...DEFAULT_TRACKING_TOWER_OPTS, ...opts };
  }

  step(world: World): TowerCommand {
    const b = world.rigidBody.position;
    const vy = world.rigidBody.velocity.y;
    const catchY = DEFAULT_ARM_HEIGHT_M;
    // Only reach for a descending booster in the catch window — otherwise hold
    // the arms home so a booster still at altitude doesn't drag them around.
    const engaged =
      vy < 0 &&
      b.y >= catchY - this.opts.engageBelowM &&
      b.y <= catchY + this.opts.engageAboveM;
    const armLateral = engaged
      ? clampArmReach(Vec3.of(b.x - NOMINAL_CENTER.x, 0, b.z - NOMINAL_CENTER.z))
      : Vec3.ZERO;
    // Arms stay in the closed gripping pose at the fixed catch height; the
    // assist is purely the lateral reach (the first increment — SLS-82).
    return { armLateral, armHeightM: catchY, armOpeningT: 0 };
  }
}
