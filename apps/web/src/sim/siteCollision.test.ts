import {
  BoosterDescentCalm,
  chopstickCaptureVolume,
  DEFAULT_TOWER_STATE,
  evaluateCatchOutcome,
  pointInAabb,
  Vec3,
  type Aabb,
} from "@starship-catch-sim/physics";
import { afterEach, describe, expect, it } from "vitest";

import { PHYSICS_CATCH_POINT } from "../state/towerTuneStore";

import {
  drawnSiteCollision,
  reportArmSegmentBoxes,
} from "./siteCollision";

describe("drawnSiteCollision (SLS-79)", () => {
  const site = drawnSiteCollision();

  it("the pinned catch point is NOT inside any failure body", () => {
    // If a solid or the ground plane covered the catch point, legitimate
    // catches would be misclassified as collisions/crashes.
    for (const solid of site.solids) {
      expect(pointInAabb(PHYSICS_CATCH_POINT, solid)).toBe(false);
    }
    expect(PHYSICS_CATCH_POINT.y).toBeGreaterThan(site.groundY);
  });

  it("the WHOLE closed capture volume clears every failure body", () => {
    // Not just the centre — the OLM top sits only ~2.7 m below the capture
    // floor, so a future OLM_DECK bump could swallow the lower corners. Check
    // all 8 corners of the full (closed) capture AABB stay out of every solid
    // and above the ground plane.
    const cap = chopstickCaptureVolume(DEFAULT_TOWER_STATE);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const corner = Vec3.of(
            cap.center.x + sx * cap.halfExtents.x,
            cap.center.y + sy * cap.halfExtents.y,
            cap.center.z + sz * cap.halfExtents.z,
          );
          for (const solid of site.solids) {
            expect(pointInAabb(corner, solid)).toBe(false);
          }
          expect(corner.y).toBeGreaterThan(site.groundY);
        }
      }
    }
  });

  it("ground plane is raised to the drawn terrain height (well above 0)", () => {
    // SITE_OFFSET lifts the visuals ~63 m; the crash plane must follow so the
    // booster stops at the drawn terrain instead of sinking through it.
    expect(site.groundY).toBeGreaterThan(40);
  });
});

describe("chopstick-arm segment collision (SLS-84)", () => {
  // The rendered tower reports per-frame world boxes; tests set them directly.
  afterEach(() => reportArmSegmentBoxes([]));

  // A small box off to the +Z side, clear of the capture volume + tower/OLM.
  const armBox: Aabb = {
    center: Vec3.of(PHYSICS_CATCH_POINT.x, PHYSICS_CATCH_POINT.y, PHYSICS_CATCH_POINT.z + 12),
    halfExtents: Vec3.of(2, 2, 2),
  };

  it("reported arm boxes go to armSolids; tower + OLM stay in solids", () => {
    expect(drawnSiteCollision().solids).toHaveLength(2); // tower + OLM (point)
    expect(drawnSiteCollision().armSolids ?? []).toHaveLength(0);
    reportArmSegmentBoxes([armBox, armBox]);
    expect(drawnSiteCollision().solids).toHaveLength(2); // tower/OLM unchanged
    expect(drawnSiteCollision().armSolids).toHaveLength(2); // arms (capsule)
  });

  it("a booster inside a reported arm box fails as a structure hit", () => {
    reportArmSegmentBoxes([armBox]);
    const base = BoosterDescentCalm.initialWorld;
    const world = {
      ...base,
      rigidBody: { ...base.rigidBody, position: armBox.center },
    };
    const outcome = evaluateCatchOutcome(
      world,
      BoosterDescentCalm.targetCatch,
      DEFAULT_TOWER_STATE,
      drawnSiteCollision(),
    );
    expect(outcome.kind).toBe("tower_collision");
  });

  it("capture-volume-first: an on-target booster is not swallowed by arm boxes", () => {
    // Even with an arm box overlapping the catch point, the capture volume wins.
    reportArmSegmentBoxes([
      { center: PHYSICS_CATCH_POINT, halfExtents: Vec3.of(5, 5, 5) },
    ]);
    const base = BoosterDescentCalm.initialWorld;
    const world = {
      ...base,
      rigidBody: { ...base.rigidBody, position: PHYSICS_CATCH_POINT },
    };
    const outcome = evaluateCatchOutcome(
      world,
      BoosterDescentCalm.targetCatch,
      DEFAULT_TOWER_STATE,
      drawnSiteCollision(),
    );
    expect(["caught", "near_miss"]).toContain(outcome.kind);
  });

  it("with no arm boxes reported, only tower + OLM solids are present", () => {
    reportArmSegmentBoxes([]);
    const solids = drawnSiteCollision().solids;
    expect(solids).toHaveLength(2);
    for (const s of solids) {
      expect(s.halfExtents.x).toBeGreaterThan(0);
      expect(s.halfExtents.y).toBeGreaterThan(0);
      expect(s.halfExtents.z).toBeGreaterThan(0);
    }
  });
});
