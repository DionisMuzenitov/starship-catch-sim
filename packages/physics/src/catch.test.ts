import { describe, expect, it } from "vitest";

import { evaluateCatchOutcome } from "./catch.js";
import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";
import { BoosterDescentStandard } from "./scenarios.js";
import { DEFAULT_TOWER_STATE, chopstickCaptureVolume } from "./tower.js";
import type { World } from "./world.js";

const ENV = BoosterDescentStandard.targetCatch;
const CAPTURE = chopstickCaptureVolume(DEFAULT_TOWER_STATE);

function worldAt(
  position: Vec3,
  velocity: Vec3,
  options: Partial<{
    attitude: Quat;
    angularVelocity: Vec3;
    propellantMass: number;
  }> = {},
): World {
  const base = BoosterDescentStandard.initialWorld;
  return {
    ...base,
    rigidBody: {
      ...base.rigidBody,
      position,
      velocity,
      attitude: options.attitude ?? Quat.IDENTITY,
      angularVelocity: options.angularVelocity ?? Vec3.ZERO,
    },
    mass:
      options.propellantMass !== undefined
        ? { ...base.mass, propellantMass: options.propellantMass }
        : base.mass,
  };
}

describe("evaluateCatchOutcome", () => {
  it("zero-velocity rocket at the capture-volume centre → caught", () => {
    const w = worldAt(CAPTURE.center, Vec3.ZERO);
    const out = evaluateCatchOutcome(w, ENV, DEFAULT_TOWER_STATE);
    expect(out.kind).toBe("caught");
    expect(out.verdict?.caught).toBe(true);
    expect(out.metrics.distanceToTargetM).toBeGreaterThanOrEqual(0);
  });

  it("inside the capture volume but descending at 20 m/s → near_miss", () => {
    const w = worldAt(CAPTURE.center, Vec3.of(0, -20, 0));
    const out = evaluateCatchOutcome(w, ENV, DEFAULT_TOWER_STATE);
    expect(out.kind).toBe("near_miss");
    expect(out.verdict?.caught).toBe(false);
    expect(out.verdict?.reason.toLowerCase()).toContain("vertical");
    expect(out.metrics.verticalSpeedMps).toBe(-20);
  });

  it("inside the tower trusses → tower_collision", () => {
    // Centre of the tower base column, mid-height.
    const w = worldAt(Vec3.of(0, 73, 0), Vec3.of(0, -10, 0));
    const out = evaluateCatchOutcome(w, ENV, DEFAULT_TOWER_STATE);
    expect(out.kind).toBe("tower_collision");
    expect(out.verdict).toBeUndefined();
  });

  it("ground impact away from the tower → crash", () => {
    const w = worldAt(Vec3.of(50, 0, 30), Vec3.of(-5, -25, 0));
    const out = evaluateCatchOutcome(w, ENV, DEFAULT_TOWER_STATE);
    expect(out.kind).toBe("crash");
  });

  it("below ground level reports crash too", () => {
    const w = worldAt(Vec3.of(30, -1, 30), Vec3.of(0, -5, 0));
    expect(evaluateCatchOutcome(w, ENV, DEFAULT_TOWER_STATE).kind).toBe(
      "crash",
    );
  });

  it("clear of tower + airborne + outside capture volume → none", () => {
    const w = worldAt(Vec3.of(100, 500, 100), Vec3.of(0, -50, 0));
    const out = evaluateCatchOutcome(w, ENV, DEFAULT_TOWER_STATE);
    expect(out.kind).toBe("none");
    expect(out.verdict).toBeUndefined();
  });

  it("with arms wide open, the centre of the (now empty) capture volume is no longer inside it", () => {
    const widelyOpen = { ...DEFAULT_TOWER_STATE, armOpeningT: 1 };
    const openCapture = chopstickCaptureVolume(widelyOpen);
    // halfExtents are zero so the centre is itself in the volume (closed
    // boundary), but +1 m off-centre is not.
    const w = worldAt(
      { ...openCapture.center, x: openCapture.center.x + 1 },
      Vec3.ZERO,
    );
    const out = evaluateCatchOutcome(w, ENV, widelyOpen);
    expect(out.kind).not.toBe("caught");
    expect(out.kind).not.toBe("near_miss");
  });

  it("metrics include tilt + angular rate + fuel", () => {
    const tiltedAttitude = Quat.fromAxisAngle(Vec3.of(0, 0, 1), Math.PI / 6);
    const w = worldAt(Vec3.of(500, 500, 500), Vec3.of(0, -10, 0), {
      attitude: tiltedAttitude,
      angularVelocity: Vec3.of(0, 0, 0.3),
      propellantMass: 1234,
    });
    const out = evaluateCatchOutcome(w, ENV, DEFAULT_TOWER_STATE);
    expect(out.kind).toBe("none");
    expect(out.metrics.tiltRad).toBeCloseTo(Math.PI / 6, 4);
    expect(out.metrics.angularRateMagRadPerS).toBeCloseTo(0.3, 6);
    expect(out.metrics.fuelRemainingKg).toBe(1234);
  });
});
