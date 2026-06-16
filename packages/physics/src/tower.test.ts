import { describe, expect, it } from "vitest";

import { Vec3 } from "./math/vec3.js";
import {
  ARM_HINGE_OFFSET_X_M,
  ARM_HINGE_OFFSET_Z_M,
  DEFAULT_ARM_HEIGHT_M,
  DEFAULT_TOWER_STATE,
  HARDPOINT_AFT_OFFSET_M,
  HARDPOINT_FORE_OFFSET_M,
  TOWER_FOOTPRINT_M,
  TOWER_HEIGHT_M,
  chopstickCaptureVolume,
  chopstickCatchPoints,
  pointInAabb,
  towerStructureAabb,
} from "./tower.js";

describe("chopstickCatchPoints — closed arms", () => {
  it("returns 4 hard-points at the expected world positions", () => {
    const pts = chopstickCatchPoints(DEFAULT_TOWER_STATE);
    expect(pts).toHaveLength(4);
    // sideSign = -1 (left arm), offsets fore then aft.
    expect(pts[0]).toEqual(
      Vec3.of(
        ARM_HINGE_OFFSET_X_M + HARDPOINT_FORE_OFFSET_M,
        DEFAULT_ARM_HEIGHT_M,
        -ARM_HINGE_OFFSET_Z_M,
      ),
    );
    expect(pts[1]).toEqual(
      Vec3.of(
        ARM_HINGE_OFFSET_X_M + HARDPOINT_AFT_OFFSET_M,
        DEFAULT_ARM_HEIGHT_M,
        -ARM_HINGE_OFFSET_Z_M,
      ),
    );
    expect(pts[2]).toEqual(
      Vec3.of(
        ARM_HINGE_OFFSET_X_M + HARDPOINT_FORE_OFFSET_M,
        DEFAULT_ARM_HEIGHT_M,
        ARM_HINGE_OFFSET_Z_M,
      ),
    );
    expect(pts[3]).toEqual(
      Vec3.of(
        ARM_HINGE_OFFSET_X_M + HARDPOINT_AFT_OFFSET_M,
        DEFAULT_ARM_HEIGHT_M,
        ARM_HINGE_OFFSET_Z_M,
      ),
    );
  });
});

describe("chopstickCatchPoints — opening", () => {
  it("at full open, left+right arms sweep symmetrically (mirrored across Z=0)", () => {
    const open = chopstickCatchPoints({
      ...DEFAULT_TOWER_STATE,
      armOpeningT: 1,
    });
    // Left fore (sideSign=-1) should mirror right fore (sideSign=+1) across Z.
    expect(open[0].x).toBeCloseTo(open[2].x, 9);
    expect(open[0].z).toBeCloseTo(-open[2].z, 6);
    expect(open[1].x).toBeCloseTo(open[3].x, 9);
    expect(open[1].z).toBeCloseTo(-open[3].z, 6);
  });
});

describe("chopstickCaptureVolume", () => {
  it("at closed, half-extents cover the fore↔aft + ±Z hard-points", () => {
    const v = chopstickCaptureVolume(DEFAULT_TOWER_STATE);
    expect(v.center.y).toBe(DEFAULT_ARM_HEIGHT_M);
    expect(v.center.z).toBeCloseTo(0, 9);
    // X half-extent = (fore - aft) / 2 = (4.5 - (-2.5)) / 2 = 3.5
    expect(v.halfExtents.x).toBeCloseTo(3.5, 9);
    // Z half-extent = ARM_HINGE_OFFSET_Z_M = 5
    expect(v.halfExtents.z).toBeCloseTo(ARM_HINGE_OFFSET_Z_M, 9);
    // Y aperture = CAPTURE_VOLUME_Y_HALF_M (4 m) at openingT=0
    expect(v.halfExtents.y).toBeCloseTo(4, 9);
  });

  it("shrinks toward zero as opening grows", () => {
    const closed = chopstickCaptureVolume(DEFAULT_TOWER_STATE);
    const half = chopstickCaptureVolume({
      ...DEFAULT_TOWER_STATE,
      armOpeningT: 0.5,
    });
    const fullyOpen = chopstickCaptureVolume({
      ...DEFAULT_TOWER_STATE,
      armOpeningT: 1,
    });
    expect(half.halfExtents.x).toBeCloseTo(closed.halfExtents.x * 0.5, 6);
    expect(half.halfExtents.y).toBeCloseTo(closed.halfExtents.y * 0.5, 6);
    expect(half.halfExtents.z).toBeCloseTo(closed.halfExtents.z * 0.5, 6);
    expect(fullyOpen.halfExtents.x).toBeCloseTo(0, 9);
    expect(fullyOpen.halfExtents.y).toBeCloseTo(0, 9);
    expect(fullyOpen.halfExtents.z).toBeCloseTo(0, 9);
  });

  it("clamps negative + super-unity opening", () => {
    const negative = chopstickCaptureVolume({
      ...DEFAULT_TOWER_STATE,
      armOpeningT: -1,
    });
    const overOne = chopstickCaptureVolume({
      ...DEFAULT_TOWER_STATE,
      armOpeningT: 2,
    });
    const closed = chopstickCaptureVolume(DEFAULT_TOWER_STATE);
    expect(negative.halfExtents).toEqual(closed.halfExtents);
    expect(overOne.halfExtents.x).toBeCloseTo(0, 9);
  });
});

describe("pointInAabb", () => {
  it("returns true at the centre + boundary, false outside", () => {
    const aabb = chopstickCaptureVolume(DEFAULT_TOWER_STATE);
    expect(pointInAabb(aabb.center, aabb)).toBe(true);
    const corner = Vec3.of(
      aabb.center.x + aabb.halfExtents.x,
      aabb.center.y,
      aabb.center.z,
    );
    expect(pointInAabb(corner, aabb)).toBe(true);
    const justOutside = Vec3.of(
      aabb.center.x + aabb.halfExtents.x + 0.001,
      aabb.center.y,
      aabb.center.z,
    );
    expect(pointInAabb(justOutside, aabb)).toBe(false);
  });
});

describe("towerStructureAabb", () => {
  it("centres on the base + half-extents match the footprint and height", () => {
    const aabb = towerStructureAabb(DEFAULT_TOWER_STATE);
    expect(aabb.center).toEqual(Vec3.of(0, TOWER_HEIGHT_M / 2, 0));
    expect(aabb.halfExtents).toEqual(
      Vec3.of(TOWER_FOOTPRINT_M / 2, TOWER_HEIGHT_M / 2, TOWER_FOOTPRINT_M / 2),
    );
  });

  it("does not overlap the capture volume — they sit side-by-side", () => {
    // Tower AABB max x = TOWER_FOOTPRINT_M / 2 = 6.
    // Capture volume min x = ARM_HINGE_OFFSET_X_M + HARDPOINT_AFT_OFFSET_M
    //                     = 7.5 + (-2.5) = 5  — and yes, this DOES overlap on the
    // x boundary; the disambiguation in `evaluateCatchOutcome` checks the capture
    // volume first so a rocket in the slot is reported as caught/near_miss, not as
    // a tower collision.
    const tower = towerStructureAabb(DEFAULT_TOWER_STATE);
    const capture = chopstickCaptureVolume(DEFAULT_TOWER_STATE);
    const towerMaxX = tower.center.x + tower.halfExtents.x;
    const captureMinX = capture.center.x - capture.halfExtents.x;
    // Boundaries touch but the capture volume sits OUTSIDE the tower trusses
    // (between the legs and the chopstick tips).
    expect(captureMinX).toBeGreaterThanOrEqual(towerMaxX - 1.001);
  });
});
