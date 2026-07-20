import { describe, expect, it } from "vitest";

import { evaluateCatchOutcome } from "./catch.js";
import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";
import { BoosterDescentStandard, BOOSTER_CAPSULE } from "./scenarios.js";
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

describe("active catch-assist widens the envelope (SLS-82)", () => {
  // 9 m off-axis in Z — outside the fixed capture volume (±5 m in Z), but
  // within the arms' reach (MAX_ARM_REACH_M = 6 m).
  const offAxis = Vec3.of(CAPTURE.center.x, CAPTURE.center.y, 9);

  it("a laterally-off booster is NOT caught by the fixed tower", () => {
    const out = evaluateCatchOutcome(
      worldAt(offAxis, Vec3.ZERO),
      ENV,
      DEFAULT_TOWER_STATE,
    );
    expect(out.kind).not.toBe("caught");
  });

  it("the same booster IS caught once the arms reach toward it", () => {
    const reached = { ...DEFAULT_TOWER_STATE, armLateral: Vec3.of(0, 0, 6) };
    const out = evaluateCatchOutcome(worldAt(offAxis, Vec3.ZERO), ENV, reached);
    expect(out.kind).toBe("caught");
    expect(out.verdict?.caught).toBe(true);
  });

  it("does NOT let an out-of-reach booster through (impossible catch)", () => {
    // 20 m off — beyond reach (6) + half-slot (5); even fully reached, the
    // capture volume can't cover it.
    const farOff = Vec3.of(CAPTURE.center.x, CAPTURE.center.y, 20);
    const reached = { ...DEFAULT_TOWER_STATE, armLateral: Vec3.of(0, 0, 6) };
    const out = evaluateCatchOutcome(worldAt(farOff, Vec3.ZERO), ENV, reached);
    expect(out.kind).not.toBe("caught");
  });
});

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

  describe("drawn-frame site collision (SLS-79)", () => {
    // A structure box away from the physics origin, and a raised ground plane
    // — the shapes the runner supplies once SITE_OFFSET moves the visuals.
    const site = {
      groundY: 63,
      solids: [
        { center: Vec3.of(-13, 136, 1), halfExtents: Vec3.of(9, 73, 9) },
        { center: Vec3.of(9, 74, 0), halfExtents: Vec3.of(10, 10, 10) },
      ],
    };

    it("inside a supplied solid (drawn tower/OLM) → tower_collision", () => {
      const w = worldAt(Vec3.of(-13, 130, 1), Vec3.of(0, -10, 0));
      expect(evaluateCatchOutcome(w, ENV, DEFAULT_TOWER_STATE, site).kind).toBe(
        "tower_collision",
      );
    });

    it("at/under the raised ground plane → crash (not the y≤0 default)", () => {
      const w = worldAt(Vec3.of(40, 62, 40), Vec3.of(0, -20, 0));
      expect(evaluateCatchOutcome(w, ENV, DEFAULT_TOWER_STATE, site).kind).toBe(
        "crash",
      );
      // Physics y is well above 0, so the legacy check would have said none —
      // proving the drawn ground height is what's used.
      expect(w.rigidBody.position.y).toBeGreaterThan(0);
    });

    it("above the raised ground and clear of solids → none", () => {
      const w = worldAt(Vec3.of(40, 80, 40), Vec3.of(0, -20, 0));
      expect(evaluateCatchOutcome(w, ENV, DEFAULT_TOWER_STATE, site).kind).toBe(
        "none",
      );
    });

    it("capture volume still wins over a supplied solid", () => {
      // Put a solid right on the catch point; a caught booster must still catch.
      const onCatch = {
        groundY: 63,
        solids: [{ center: CAPTURE.center, halfExtents: Vec3.of(20, 20, 20) }],
      };
      const w = worldAt(CAPTURE.center, Vec3.ZERO);
      expect(evaluateCatchOutcome(w, ENV, DEFAULT_TOWER_STATE, onCatch).kind).toBe(
        "caught",
      );
    });
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

describe("booster capsule collision (ADR-020 / SLS-86)", () => {
  // Arms use the capsule test; put the probe box there (tower/OLM `solids` stay
  // CoM-point tested).
  const SITE = (arm: { center: Vec3; halfExtents: Vec3 }) => ({
    groundY: -1000,
    solids: [],
    armSolids: [arm],
  });
  // A structure box 31 m BELOW an upright booster's CoM — beyond its centre
  // point, but within reach of its 31 m core half-length (radius 4.5).
  const boxBelow = {
    center: Vec3.of(-20, 60, 0),
    halfExtents: Vec3.of(1, 1, 1),
  };
  const upright = worldAt(Vec3.of(-20, 91, 0), Vec3.ZERO); // clear of capture vol

  it("the capsule hits a structure box the CoM point misses", () => {
    // A CoM-centred capsule (offset 0) reaching 31 m down — tests the sweep,
    // independent of BOOSTER_CAPSULE's baked (shifted-up) offset.
    const centred = { radius: 4.5, halfLength: 31, offset: 0 };
    const asPoint = evaluateCatchOutcome(upright, ENV, DEFAULT_TOWER_STATE, SITE(boxBelow));
    expect(asPoint.kind).toBe("none"); // CoM (y=91) is nowhere near the box (y=60)
    const asCapsule = evaluateCatchOutcome(
      upright, ENV, DEFAULT_TOWER_STATE, SITE(boxBelow), centred,
    );
    expect(asCapsule.kind).toBe("tower_collision"); // the body reaches down to it
  });

  it("the capsule offset shifts the collider along the body axis", () => {
    // Same box, but a capsule shifted UP by 40 m no longer reaches down to it.
    const shiftedUp = { radius: 4.5, halfLength: 31, offset: 40 };
    const out = evaluateCatchOutcome(upright, ENV, DEFAULT_TOWER_STATE, SITE(boxBelow), shiftedUp);
    expect(out.kind).toBe("none");
  });

  it("a horizontal (belly-flop) capsule reaches sideways where upright would not", () => {
    // Booster laid on its side (+Y body axis → +X world): the capsule now
    // extends ±31 m in X, so a box 25 m to the +X side is hit.
    const boxSide = { center: Vec3.of(5, 91, 0), halfExtents: Vec3.of(1, 1, 1) };
    const belly = worldAt(Vec3.of(-20, 91, 0), Vec3.ZERO, {
      attitude: Quat.fromAxisAngle(Vec3.of(0, 0, 1), -Math.PI / 2), // +Y → +X
    });
    const out = evaluateCatchOutcome(
      belly, ENV, DEFAULT_TOWER_STATE, SITE(boxSide), BOOSTER_CAPSULE,
    );
    expect(out.kind).toBe("tower_collision");
  });

  it("capture-volume-first: a valid catch is never a graze, even if the capsule overlaps arms", () => {
    const caught = worldAt(CAPTURE.center, Vec3.ZERO); // in capture volume, envelope ok
    const armAtCatch = { center: CAPTURE.center, halfExtents: Vec3.of(2, 2, 2) };
    const out = evaluateCatchOutcome(
      caught, ENV, DEFAULT_TOWER_STATE, SITE(armAtCatch), BOOSTER_CAPSULE,
    );
    expect(out.kind).toBe("caught");
  });
});
