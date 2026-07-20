import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { Vec3 } from "./math/vec3.js";
import {
  ARM_HEIGHT_MAX_M,
  ARM_HEIGHT_MIN_M,
  ARM_HINGE_OFFSET_X_M,
  ARM_HINGE_OFFSET_Z_M,
  DEFAULT_ARM_HEIGHT_M,
  DEFAULT_TOWER_STATE,
  HARDPOINT_AFT_OFFSET_M,
  HARDPOINT_FORE_OFFSET_M,
  MAX_ARM_REACH_M,
  TOWER_FOOTPRINT_M,
  TOWER_HEIGHT_M,
  chopstickCaptureVolume,
  chopstickCatchPoints,
  clampArmReach,
  pointInAabb,
  stepTowerState,
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

describe("active catch-assist (SLS-82)", () => {
  it("HEADLINE GUARD: default tower catch target is unchanged (8.5, 91, 0)", () => {
    // The whole SLS-82 design rests on this: with zero reach the live capture
    // centre must equal the pre-assist fixed catch point, so the Monte-Carlo
    // benches + SLS-66 floor never move.
    const c = chopstickCaptureVolume(DEFAULT_TOWER_STATE).center;
    expect(c.x).toBeCloseTo(8.5, 9);
    expect(c.y).toBeCloseTo(DEFAULT_ARM_HEIGHT_M, 9);
    expect(c.z).toBeCloseTo(0, 9);
    expect(DEFAULT_TOWER_STATE.armLateral).toEqual(Vec3.ZERO);
  });

  it("lateral reach shifts the capture volume by exactly that offset", () => {
    const base = chopstickCaptureVolume(DEFAULT_TOWER_STATE);
    const reached = chopstickCaptureVolume({
      ...DEFAULT_TOWER_STATE,
      armLateral: Vec3.of(2, 0, -3),
    });
    expect(reached.center.x).toBeCloseTo(base.center.x + 2, 9);
    expect(reached.center.z).toBeCloseTo(base.center.z - 3, 9);
    // Shape is unchanged — the arms translate, they don't grow.
    expect(reached.halfExtents).toEqual(base.halfExtents);
  });

  it("lateral reach does NOT move the tower structure box", () => {
    const a = towerStructureAabb({
      ...DEFAULT_TOWER_STATE,
      armLateral: Vec3.of(5, 0, 5),
    });
    expect(a).toEqual(towerStructureAabb(DEFAULT_TOWER_STATE));
  });

  describe("clampArmReach", () => {
    it("passes a within-reach vector through (zeroing y)", () => {
      expect(clampArmReach(Vec3.of(2, 9, -1))).toEqual(Vec3.of(2, 0, -1));
    });
    it("clamps an over-reach vector to the max magnitude, keeping direction", () => {
      const out = clampArmReach(Vec3.of(30, 0, 0));
      expect(Math.hypot(out.x, out.z)).toBeCloseTo(MAX_ARM_REACH_M, 9);
      expect(out.x).toBeGreaterThan(0);
    });
    it("leaves zero as zero", () => {
      expect(clampArmReach(Vec3.ZERO)).toEqual(Vec3.ZERO);
    });
  });

  describe("stepTowerState", () => {
    const cmd = {
      armLateral: Vec3.of(4, 0, 0),
      armHeightM: 80,
      armOpeningT: 0,
    };
    it("moves partway toward the command in one tick (first-order lag)", () => {
      const next = stepTowerState(DEFAULT_TOWER_STATE, cmd, 0.02);
      expect(next.armLateral.x).toBeGreaterThan(0);
      expect(next.armLateral.x).toBeLessThan(cmd.armLateral.x); // not teleported
      expect(next.armHeightM).toBeLessThan(DEFAULT_TOWER_STATE.armHeightM);
      expect(next.armHeightM).toBeGreaterThan(cmd.armHeightM);
    });
    it("never oversteps the command however large dt is", () => {
      const next = stepTowerState(DEFAULT_TOWER_STATE, cmd, 100);
      expect(next.armLateral.x).toBeCloseTo(cmd.armLateral.x, 3);
      expect(next.armHeightM).toBeCloseTo(cmd.armHeightM, 3);
    });
    it("clamps the commanded reach + carriage travel", () => {
      const next = stepTowerState(
        DEFAULT_TOWER_STATE,
        { armLateral: Vec3.of(999, 0, 0), armHeightM: 9999, armOpeningT: 5 },
        100,
      );
      expect(Math.hypot(next.armLateral.x, next.armLateral.z)).toBeCloseTo(
        MAX_ARM_REACH_M,
        3,
      );
      expect(next.armHeightM).toBeCloseTo(ARM_HEIGHT_MAX_M, 3);
      expect(next.armOpeningT).toBeLessThanOrEqual(1);
      expect(next.armOpeningT).toBeGreaterThanOrEqual(0);
      // and the low end of carriage travel
      const low = stepTowerState(
        DEFAULT_TOWER_STATE,
        { armLateral: Vec3.ZERO, armHeightM: -100, armOpeningT: 0 },
        100,
      );
      expect(low.armHeightM).toBeCloseTo(ARM_HEIGHT_MIN_M, 3);
    });
    it("dt = 0 is a no-op", () => {
      expect(stepTowerState(DEFAULT_TOWER_STATE, cmd, 0)).toEqual(
        DEFAULT_TOWER_STATE,
      );
    });
  });
});

describe("active catch-assist invariants (property)", () => {
  const coord = () =>
    fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true });
  const dt = () =>
    fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });
  // A reachable tower pose (in-range height/opening, in-reach lateral).
  const reachable = () =>
    fc
      .record({
        lx: coord(),
        lz: coord(),
        h: fc.double({ min: ARM_HEIGHT_MIN_M, max: ARM_HEIGHT_MAX_M, noNaN: true }),
        o: fc.double({ min: 0, max: 1, noNaN: true }),
      })
      .map(({ lx, lz, h, o }) => ({
        ...DEFAULT_TOWER_STATE,
        armLateral: clampArmReach(Vec3.of(lx, 0, lz)),
        armHeightM: h,
        armOpeningT: o,
      }));

  it("clampArmReach: output never exceeds MAX_ARM_REACH_M and zeroes y", () => {
    fc.assert(
      fc.property(coord(), coord(), (x, z) => {
        const out = clampArmReach(Vec3.of(x, 0, z));
        expect(Math.hypot(out.x, out.z)).toBeLessThanOrEqual(
          MAX_ARM_REACH_M + 1e-9,
        );
        expect(out.y).toBe(0);
      }),
    );
  });

  it("stepTowerState: keeps every DOF inside its clamp from any reachable pose", () => {
    fc.assert(
      fc.property(reachable(), coord(), coord(), coord(), fc.double({ min: -2, max: 3, noNaN: true }), dt(), (state, cx, cz, ch, co, d) => {
        const next = stepTowerState(
          state,
          { armLateral: Vec3.of(cx, 0, cz), armHeightM: ch, armOpeningT: co },
          d,
        );
        expect(Math.hypot(next.armLateral.x, next.armLateral.z)).toBeLessThanOrEqual(
          MAX_ARM_REACH_M + 1e-6,
        );
        expect(next.armHeightM).toBeGreaterThanOrEqual(ARM_HEIGHT_MIN_M - 1e-6);
        expect(next.armHeightM).toBeLessThanOrEqual(ARM_HEIGHT_MAX_M + 1e-6);
        expect(next.armOpeningT).toBeGreaterThanOrEqual(0);
        expect(next.armOpeningT).toBeLessThanOrEqual(1);
      }),
    );
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
