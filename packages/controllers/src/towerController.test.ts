import {
  BoosterDescentStandard,
  DEFAULT_ARM_HEIGHT_M,
  MAX_ARM_REACH_M,
  Vec3,
  type World,
} from "@starship-catch-sim/physics";
import { describe, expect, it } from "vitest";

import { TrackingTowerController } from "./towerController.js";

// Nominal catch centre is (8.5, 91, 0); the controller reaches relative to it.
const NOMINAL_X = 8.5;

function worldAt(position: Vec3, velocity: Vec3): World {
  const base = BoosterDescentStandard.initialWorld;
  return {
    ...base,
    rigidBody: { ...base.rigidBody, position, velocity },
  };
}

describe("TrackingTowerController", () => {
  const ctl = new TrackingTowerController();

  it("holds the arms home for a booster still high above the catch", () => {
    const cmd = ctl.step(worldAt(Vec3.of(NOMINAL_X, 400, 0), Vec3.of(0, -50, 0)));
    expect(cmd.armLateral).toEqual(Vec3.ZERO);
  });

  it("holds the arms home for an ASCENDING booster in the window", () => {
    const cmd = ctl.step(worldAt(Vec3.of(NOMINAL_X + 3, 95, 4), Vec3.of(0, 5, 0)));
    expect(cmd.armLateral).toEqual(Vec3.ZERO);
  });

  it("reaches toward a descending booster just OUTSIDE the fixed slot", () => {
    // Offset (4.5, 0): x is beyond the fixed ±3.5 m slot, within the 6 m reach.
    const cmd = ctl.step(
      worldAt(Vec3.of(NOMINAL_X + 4.5, 95, 0), Vec3.of(0, -3, 0)),
    );
    expect(cmd.armLateral.x).toBeCloseTo(4.5, 9);
    expect(cmd.armLateral.z).toBeCloseTo(0, 9);
  });

  it("holds the arms home for a booster the fixed slot already covers", () => {
    // Offset (2, 2) sits inside the fixed slot (±3.5 x / ±5 z) — the stationary
    // tower catches it, so the assist must not displace the arms (no regression).
    const cmd = ctl.step(worldAt(Vec3.of(NOMINAL_X + 2, 95, 2), Vec3.of(0, -3, 0)));
    expect(cmd.armLateral).toEqual(Vec3.ZERO);
  });

  it("clamps the reach for a badly-off booster (can't teleport across the pad)", () => {
    const cmd = ctl.step(
      worldAt(Vec3.of(NOMINAL_X + 20, 95, 20), Vec3.of(0, -3, 0)),
    );
    expect(Math.hypot(cmd.armLateral.x, cmd.armLateral.z)).toBeCloseTo(
      MAX_ARM_REACH_M,
      9,
    );
  });

  it("keeps the arms closed at the fixed catch height (lateral-only assist)", () => {
    const cmd = ctl.step(
      worldAt(Vec3.of(NOMINAL_X + 2, 95, 2), Vec3.of(0, -3, 0)),
    );
    expect(cmd.armOpeningT).toBe(0);
    expect(cmd.armHeightM).toBe(DEFAULT_ARM_HEIGHT_M);
  });
});
