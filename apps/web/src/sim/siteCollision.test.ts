import {
  chopstickCaptureVolume,
  DEFAULT_TOWER_STATE,
  pointInAabb,
  Vec3,
} from "@starship-catch-sim/physics";
import { describe, expect, it } from "vitest";

import { PHYSICS_CATCH_POINT } from "../state/towerTuneStore";

import { drawnSiteCollision } from "./siteCollision";

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

  it("supplies both a tower and an OLM solid", () => {
    expect(site.solids.length).toBe(2);
    for (const s of site.solids) {
      expect(s.halfExtents.x).toBeGreaterThan(0);
      expect(s.halfExtents.y).toBeGreaterThan(0);
      expect(s.halfExtents.z).toBeGreaterThan(0);
    }
  });
});
