import { pointInAabb } from "@starship-catch-sim/physics";
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
