import {
  Quat,
  Vec3,
  boosterDescentScenario,
  type World,
} from "@starship-catch-sim/physics";
import { describe, expect, it } from "vitest";

import { __forTests } from "./cinematicRigs";
import { DEFAULT_ENV, modeTargetFor, SITE_GROUND_Y_M } from "./modes";

const baseWorld: World = boosterDescentScenario().initialWorld;

function worldAtAltitude(altM: number): World {
  return {
    ...baseWorld,
    rigidBody: {
      ...baseWorld.rigidBody,
      // Reset attitude to identity so position-only tests aren't
      // confounded by the scenario IC's retrograde attitude.
      attitude: { x: 0, y: 0, z: 0, w: 1 },
      position: Vec3.of(0, altM, 0),
    },
  };
}

describe("modeTargetFor", () => {
  it("chase keeps rocket framed: position offset grows with altitude, capped", () => {
    const low = modeTargetFor("chase", worldAtAltitude(100), DEFAULT_ENV, 0)!;
    const mid = modeTargetFor("chase", worldAtAltitude(2000), DEFAULT_ENV, 0)!;
    const high = modeTargetFor("chase", worldAtAltitude(10_000), DEFAULT_ENV, 0)!;

    expect(low.lookAt).toEqual(worldAtAltitude(100).rigidBody.position);

    const lowDist = -low.position.z;
    const midDist = -mid.position.z;
    const highDist = -high.position.z;
    expect(midDist).toBeGreaterThan(lowDist);
    expect(highDist).toBeLessThanOrEqual(600 + 1e-6);
    expect(highDist).toBeGreaterThanOrEqual(120 - 1e-6);
  });

  it("chase is world-up-locked: camera height is above the rocket", () => {
    const high = modeTargetFor("chase", worldAtAltitude(5000), DEFAULT_ENV, 0)!;
    expect(high.position.y).toBeGreaterThan(5000);
    expect(high.position.y - 5000).toBeLessThanOrEqual(200 + 1e-6);
  });

  it("tower camera frames the fixed catch point from the side (SLS-58)", () => {
    const t = modeTargetFor("tower", worldAtAltitude(800), DEFAULT_ENV, 0)!;
    // Off to the side at arm height, centred on the fixed catch point — not the
    // (moving) booster, so the catch stays framed.
    expect(t.position).toEqual(Vec3.of(90, 95, 50));
    expect(t.lookAt).toEqual(Vec3.of(8.5, 91, 0));
  });

  it("ground camera seeds a fixed human vantage beside the tower (SLS-58)", () => {
    const g = modeTargetFor("ground", worldAtAltitude(800), DEFAULT_ENV, 0)!;
    // Stands a few m above the site ground level (the terrain is shifted up by
    // SITE_OFFSET.y), not at y=0, looking up toward the catch.
    expect(g.position).toEqual(Vec3.of(100, SITE_GROUND_Y_M + 5, 60));
    expect(g.position.y).toBeGreaterThan(SITE_GROUND_Y_M);
    expect(g.lookAt).toEqual(Vec3.of(8.5, 91, 0));
  });

  it("onboard places camera above CoM along the body axis and looks down it", () => {
    const o = modeTargetFor("onboard", worldAtAltitude(800), DEFAULT_ENV, 0)!;
    // Upright booster: body +Y == world +Y, so camera sits 45 m above CoM
    // (pulled outside the hull, SLS-58) and looks well below itself.
    expect(o.position.y).toBeCloseTo(845, 6);
    expect(o.lookAt.y).toBeLessThan(o.position.y);
  });

  it("onboard tracks attitude: 90° pitch swings the offset onto -X", () => {
    const q = Quat.fromAxisAngle(Vec3.of(0, 0, 1), Math.PI / 2);
    const world: World = {
      ...baseWorld,
      rigidBody: {
        ...baseWorld.rigidBody,
        position: Vec3.of(0, 800, 0),
        attitude: q,
      },
    };
    const o = modeTargetFor("onboard", world, DEFAULT_ENV, 0)!;
    // After +π/2 around Z: body +Y → world -X, so the 45 m body-up offset lands
    // at x ~ -45 from the rocket (and the body-Z offset stays on world Z).
    expect(o.position.x).toBeCloseTo(-45, 5);
    expect(o.position.y).toBeCloseTo(800, 5);
  });

  it("cinematic cycles through 4 rigs deterministically", () => {
    const w = worldAtAltitude(500);
    const interval = __forTests.RIG_INTERVAL_S;
    const t0 = modeTargetFor("cinematic", w, DEFAULT_ENV, 0)!;
    const t1 = modeTargetFor("cinematic", w, DEFAULT_ENV, interval)!;
    const t4 = modeTargetFor("cinematic", w, DEFAULT_ENV, 4 * interval)!;
    expect(t1.position).not.toEqual(t0.position);
    // After 4 intervals we're back on rig 0.
    expect(t4.position).toEqual(t0.position);
  });

  it("free returns null so the rig can hand control to OrbitControls", () => {
    expect(
      modeTargetFor("free", worldAtAltitude(800), DEFAULT_ENV, 0),
    ).toBeNull();
  });
});
