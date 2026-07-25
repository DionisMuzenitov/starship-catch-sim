import {
  Quat,
  Vec3,
  boosterDescentScenario,
  type World,
} from "@starship-catch-sim/physics";
import { describe, expect, it } from "vitest";

import { __forTests, cinematicView } from "./cinematicRigs";
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
    const low = modeTargetFor("chase", worldAtAltitude(100), DEFAULT_ENV)!;
    const mid = modeTargetFor("chase", worldAtAltitude(2000), DEFAULT_ENV)!;
    const high = modeTargetFor("chase", worldAtAltitude(10_000), DEFAULT_ENV)!;

    expect(low.lookAt).toEqual(worldAtAltitude(100).rigidBody.position);

    const lowDist = -low.position.z;
    const midDist = -mid.position.z;
    const highDist = -high.position.z;
    expect(midDist).toBeGreaterThan(lowDist);
    expect(highDist).toBeLessThanOrEqual(600 + 1e-6);
    expect(highDist).toBeGreaterThanOrEqual(120 - 1e-6);
  });

  it("chase is world-up-locked: camera height is above the rocket", () => {
    const high = modeTargetFor("chase", worldAtAltitude(5000), DEFAULT_ENV)!;
    expect(high.position.y).toBeGreaterThan(5000);
    expect(high.position.y - 5000).toBeLessThanOrEqual(200 + 1e-6);
  });

  it("tower camera frames the fixed catch point from the side (SLS-58)", () => {
    const t = modeTargetFor("tower", worldAtAltitude(800), DEFAULT_ENV)!;
    // Off to the side at arm height, centred on the fixed catch point — not the
    // (moving) booster, so the catch stays framed.
    expect(t.position).toEqual(Vec3.of(90, 95, 50));
    expect(t.lookAt).toEqual(Vec3.of(8.5, 91, 0));
  });

  it("ground camera seeds a fixed human vantage beside the tower (SLS-58)", () => {
    const g = modeTargetFor("ground", worldAtAltitude(800), DEFAULT_ENV)!;
    // Stands a few m above the site ground level (the terrain is shifted up by
    // SITE_OFFSET.y), not at y=0, looking up toward the catch.
    expect(g.position).toEqual(Vec3.of(100, SITE_GROUND_Y_M + 5, 60));
    expect(g.position.y).toBeGreaterThan(SITE_GROUND_Y_M);
    expect(g.lookAt).toEqual(Vec3.of(8.5, 91, 0));
  });

  it("onboard places camera above CoM along the body axis and looks down it", () => {
    const o = modeTargetFor("onboard", worldAtAltitude(800), DEFAULT_ENV)!;
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
    const o = modeTargetFor("onboard", world, DEFAULT_ENV)!;
    // After +π/2 around Z: body +Y → world -X, so the 45 m body-up offset lands
    // at x ~ -45 from the rocket (and the body-Z offset stays on world Z).
    expect(o.position.x).toBeCloseTo(-45, 5);
    expect(o.position.y).toBeCloseTo(800, 5);
  });

  it("cinematic director glues the booster to frame and moves the angle over time", () => {
    // Descent (mid alt, not catch): camera sits at booster + a shot-distance
    // offset; the look point is on the booster's vertical axis (only a Y bias).
    const w = worldAtAltitude(5_000);
    const r = w.rigidBody.position;
    const v0 = cinematicView(w, 0);
    const d0 = Math.hypot(
      v0.position.x - r.x,
      v0.position.y - r.y,
      v0.position.z - r.z,
    );
    // Opens on the WIDE establishing shot (SHOTS[0], 140 m × 1.7 ≈ 238 m), NOT
    // the tight dolly-in (95 m × 1.7 ≈ 162 m) — the t=0 cross-fade regression.
    expect(d0).toBeGreaterThan(220);
    expect(d0).toBeLessThan(255);
    expect(v0.lookAt.x).toBeCloseTo(r.x, 5);
    expect(v0.lookAt.z).toBeCloseTo(r.z, 5);

    // Delta-follow: at a fixed real time the camera pose is a pure function of
    // the booster position, so it tracks with zero lag — moving the booster
    // moves the whole rig by the same delta.
    const moved: World = {
      ...w,
      rigidBody: { ...w.rigidBody, position: Vec3.of(100, 5_000, 200) },
    };
    const vMoved = cinematicView(moved, 0);
    expect(vMoved.position.x - v0.position.x).toBeCloseTo(100, 5);
    expect(vMoved.position.z - v0.position.z).toBeCloseTo(200, 5);

    // The rig MOVES over its real-time clock (the orbit) — different t, different pose.
    expect(cinematicView(w, 3).position).not.toEqual(v0.position);

    // The catch money shot engages by PROXIMITY (< CATCH_CAM_ALT_M), so it never
    // points near-straight-up at a distant booster; above it the orbit still runs.
    const catchLo = cinematicView(worldAtAltitude(150), 0);
    expect(catchLo.position).toEqual(__forTests.CATCH_CAM);
    // still above the threshold at 300 m → orbit, not the fixed money shot.
    expect(cinematicView(worldAtAltitude(300), 0).position).not.toEqual(
      __forTests.CATCH_CAM,
    );
    // look point tracks the booster but is biased ABOVE the CoM (focus on the top).
    const rc = worldAtAltitude(150).rigidBody.position;
    expect(catchLo.lookAt.x).toBeCloseTo(rc.x, 5);
    expect(catchLo.lookAt.z).toBeCloseTo(rc.z, 5);
    expect(catchLo.lookAt.y).toBeGreaterThan(rc.y);

    // forceCatch latch (hysteresis): the rig holds the money shot even if the
    // booster bounces back above the threshold, so it can't strobe.
    expect(cinematicView(worldAtAltitude(5_000), 0, true).position).toEqual(
      __forTests.CATCH_CAM,
    );

    // Crane bias: high up, the camera rides ABOVE the booster (elevation lifts
    // with altitude) so the ground is in frame; low down it drops to the shots'
    // own angles. Compare the camera's height-above-booster at 60 km vs 4 km.
    const hi = cinematicView(worldAtAltitude(60_000), 0);
    const lo = cinematicView(worldAtAltitude(4_000), 0);
    expect(hi.position.y - 60_000).toBeGreaterThan(lo.position.y - 4_000);
  });

  it("free returns null so the rig can hand control to OrbitControls", () => {
    expect(
      modeTargetFor("free", worldAtAltitude(800), DEFAULT_ENV),
    ).toBeNull();
  });
});
