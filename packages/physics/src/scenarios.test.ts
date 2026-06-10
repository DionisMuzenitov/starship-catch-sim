import { describe, expect, it } from "vitest";

import { neutralControl } from "./control.js";
import { tankCapacity } from "./mass.js";
import { Vec3 } from "./math/vec3.js";
import { simStep } from "./world.js";

import {
  BoosterDescentStandard,
  BoosterDescentStormy,
  SCENARIOS,
  evaluateCatch,
  scenarioById,
} from "./scenarios.js";

const DT = 0.05;

describe("scenarios — exported set", () => {
  it("registers exactly the 3 booster descent variants", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual([
      "booster-descent-calm",
      "booster-descent-standard",
      "booster-descent-stormy",
    ]);
    expect(SCENARIOS.map((s) => s.difficulty)).toEqual([
      "calm",
      "standard",
      "stormy",
    ]);
  });

  it("scenarioById finds known + returns undefined for unknown", () => {
    expect(scenarioById("booster-descent-stormy")?.id).toBe(
      "booster-descent-stormy",
    );
    expect(scenarioById("no-such-scenario")).toBeUndefined();
  });

  it("all variants share initial position, velocity, fuel ~10 % of tank capacity", () => {
    for (const s of SCENARIOS) {
      const r = s.initialWorld.rigidBody.position;
      expect(r).toEqual(Vec3.of(0, 65_000, 50_000));
      const v = s.initialWorld.rigidBody.velocity;
      expect(v).toEqual(Vec3.of(0, -200, -300));
      const propMass = s.initialWorld.mass.propellantMass;
      const cap = tankCapacity(s.initialWorld.mass);
      expect(propMass / cap).toBeGreaterThan(0.08);
      expect(propMass / cap).toBeLessThan(0.12);
    }
  });

  it("retrograde attitude: body +Y in world frame is opposite the velocity vector", () => {
    // Body +Y rotated by the initial attitude should point in (0, +0.555, +0.832).
    const s = BoosterDescentStandard;
    const q = s.initialWorld.rigidBody.attitude;
    // Quaternion rotation of (0,1,0).
    const bodyUpWorld = {
      x: 2 * (q.x * q.y - q.w * q.z),
      y: q.w * q.w - q.x * q.x + q.y * q.y - q.z * q.z,
      z: 2 * (q.y * q.z + q.w * q.x),
    };
    expect(bodyUpWorld.x).toBeCloseTo(0, 3);
    expect(bodyUpWorld.y).toBeCloseTo(0.5547, 3);
    expect(bodyUpWorld.z).toBeCloseTo(0.8321, 3);
  });
});

describe("Standard scenario — engines-off smoke", () => {
  it("after 30 s of zero control input, altitude has materially dropped", () => {
    let world = BoosterDescentStandard.initialWorld;
    const ctl = neutralControl(BoosterDescentStandard.vehicle.surfaces.length, 0);
    const y0 = world.rigidBody.position.y;
    for (let i = 0; i < Math.round(30 / DT); i++) {
      world = simStep(
        world,
        BoosterDescentStandard.vehicle,
        ctl,
        DT,
        BoosterDescentStandard.env,
      );
    }
    expect(world.rigidBody.position.y).toBeLessThan(y0 - 3_000);
  });

  it("with enough roll time, free-fall does pass sea level", () => {
    let world = BoosterDescentStandard.initialWorld;
    const ctl = neutralControl(BoosterDescentStandard.vehicle.surfaces.length, 0);
    const N = Math.round(180 / DT);
    let crossed = false;
    for (let i = 0; i < N; i++) {
      world = simStep(
        world,
        BoosterDescentStandard.vehicle,
        ctl,
        DT,
        BoosterDescentStandard.env,
      );
      if (world.rigidBody.position.y <= 0) {
        crossed = true;
        break;
      }
    }
    expect(crossed).toBe(true);
  });
});

describe("Wind plumbing — Calm vs Stormy", () => {
  it("stormy wind is deterministic across two fresh runs", () => {
    let a = BoosterDescentStormy.initialWorld;
    let b = BoosterDescentStormy.initialWorld;
    const ctl = neutralControl(BoosterDescentStormy.vehicle.surfaces.length, 0);
    const N = Math.round(5 / DT);
    for (let i = 0; i < N; i++) {
      a = simStep(
        a,
        BoosterDescentStormy.vehicle,
        ctl,
        DT,
        BoosterDescentStormy.env,
      );
      b = simStep(
        b,
        BoosterDescentStormy.vehicle,
        ctl,
        DT,
        BoosterDescentStormy.env,
      );
    }
    expect(a.rigidBody.position).toEqual(b.rigidBody.position);
    expect(a.rigidBody.velocity).toEqual(b.rigidBody.velocity);
  });
});

describe("evaluateCatch", () => {
  const envelope = BoosterDescentStandard.targetCatch;
  const target = envelope.targetPosition;

  it("a perfect catch reports caught: true", () => {
    const w = {
      ...BoosterDescentStandard.initialWorld,
      rigidBody: {
        ...BoosterDescentStandard.initialWorld.rigidBody,
        position: target,
        velocity: Vec3.of(0, 0, 0),
        attitude: { x: 0, y: 0, z: 0, w: 1 },
        angularVelocity: Vec3.of(0, 0, 0),
      },
    };
    expect(evaluateCatch(w, envelope)).toEqual({
      caught: true,
      reason: "within catch envelope",
    });
  });

  it("a high vertical speed flags the verdict + cites it", () => {
    const w = {
      ...BoosterDescentStandard.initialWorld,
      rigidBody: {
        ...BoosterDescentStandard.initialWorld.rigidBody,
        position: target,
        velocity: Vec3.of(0, -10, 0),
        attitude: { x: 0, y: 0, z: 0, w: 1 },
        angularVelocity: Vec3.of(0, 0, 0),
      },
    };
    const v = evaluateCatch(w, envelope);
    expect(v.caught).toBe(false);
    expect(v.reason.toLowerCase()).toContain("vertical");
  });

  it("position miss is reported with the magnitude", () => {
    const w = {
      ...BoosterDescentStandard.initialWorld,
      rigidBody: {
        ...BoosterDescentStandard.initialWorld.rigidBody,
        position: Vec3.of(target.x + 50, target.y, target.z),
        velocity: Vec3.of(0, 0, 0),
        attitude: { x: 0, y: 0, z: 0, w: 1 },
        angularVelocity: Vec3.of(0, 0, 0),
      },
    };
    const v = evaluateCatch(w, envelope);
    expect(v.caught).toBe(false);
    expect(v.reason.toLowerCase()).toContain("position");
  });
});
