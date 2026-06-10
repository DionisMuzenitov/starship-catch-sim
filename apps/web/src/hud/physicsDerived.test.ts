import {
  Quat,
  Vec3,
  boosterDescentScenario,
  type World,
} from "@starship-catch-sim/physics";
import { describe, expect, it } from "vitest";

import {
  attitudeAngles,
  fuelFraction,
  groundSpeed,
  groupAnyOn,
  groupThrottle,
  horizontalSpeed,
  isaTemperatureK,
  machNumber,
  predictedImpact,
  speedOfSound,
  towerProximity,
  verticalSpeed,
} from "./physicsDerived";

const scenario = boosterDescentScenario();
const baseWorld: World = scenario.initialWorld;
const vehicle = scenario.vehicle;

function withVelocity(v: { x: number; y: number; z: number }): World {
  return {
    ...baseWorld,
    rigidBody: { ...baseWorld.rigidBody, velocity: Vec3.of(v.x, v.y, v.z) },
  };
}

function withPosition(p: { x: number; y: number; z: number }): World {
  return {
    ...baseWorld,
    rigidBody: { ...baseWorld.rigidBody, position: Vec3.of(p.x, p.y, p.z) },
  };
}

describe("ISA atmosphere helpers", () => {
  it("sea-level temperature is ~288 K and c ~ 340 m/s", () => {
    expect(isaTemperatureK(0)).toBeCloseTo(288.15, 6);
    expect(speedOfSound(0)).toBeCloseTo(340.29, 1);
  });
  it("temperature plateaus in the stratosphere", () => {
    const tHigh = isaTemperatureK(20_000);
    expect(tHigh).toBe(216.65);
  });
  it("speed of sound is lower at altitude", () => {
    expect(speedOfSound(10_000)).toBeLessThan(speedOfSound(0));
  });
});

describe("speed components", () => {
  it("vertical / horizontal / ground decompose correctly", () => {
    const w = withVelocity({ x: 30, y: -40, z: 0 });
    expect(verticalSpeed(w)).toBe(-40);
    expect(horizontalSpeed(w)).toBeCloseTo(30, 6);
    expect(groundSpeed(w)).toBeCloseTo(50, 6);
  });
});

describe("machNumber", () => {
  it("reaches ~Mach 1 at sea level with v = 340 m/s", () => {
    const w = withVelocity({ x: 340, y: 0, z: 0 });
    expect(machNumber(w)).toBeCloseTo(1, 1);
  });
  it("is higher at altitude for the same speed (lower c)", () => {
    const low = { ...withVelocity({ x: 0, y: -200, z: 0 }) };
    const high = withPosition({ x: 0, y: 10_000, z: 0 });
    const highVel = {
      ...high,
      rigidBody: { ...high.rigidBody, velocity: Vec3.of(0, -200, 0) },
    };
    expect(machNumber(highVel)).toBeGreaterThan(machNumber(low));
  });
});

describe("attitudeAngles", () => {
  it("identity quaternion → zero angles", () => {
    const w: World = {
      ...baseWorld,
      rigidBody: { ...baseWorld.rigidBody, attitude: Quat.IDENTITY },
    };
    const a = attitudeAngles(w);
    expect(a.pitch).toBeCloseTo(0, 6);
    expect(a.roll).toBeCloseTo(0, 6);
    expect(a.yaw).toBeCloseTo(0, 6);
  });
  it("rotation about Z gives yaw", () => {
    const q = Quat.fromAxisAngle(Vec3.of(0, 0, 1), Math.PI / 4);
    const w: World = {
      ...baseWorld,
      rigidBody: { ...baseWorld.rigidBody, attitude: q },
    };
    const a = attitudeAngles(w);
    expect(a.yaw).toBeCloseTo(Math.PI / 4, 5);
  });
  it("rotation about X gives roll", () => {
    const q = Quat.fromAxisAngle(Vec3.of(1, 0, 0), Math.PI / 6);
    const w: World = {
      ...baseWorld,
      rigidBody: { ...baseWorld.rigidBody, attitude: q },
    };
    const a = attitudeAngles(w);
    expect(a.roll).toBeCloseTo(Math.PI / 6, 5);
  });
});

describe("engine group reads", () => {
  it("at scenario load: all throttles 0 and engines off", () => {
    expect(groupThrottle(baseWorld, vehicle, "centre")).toBe(0);
    expect(groupAnyOn(baseWorld, vehicle, "centre")).toBe(false);
  });
  it("groupAnyOn reports true when at least one engine is on", () => {
    const w: World = {
      ...baseWorld,
      engineStates: baseWorld.engineStates.map((s, i) =>
        i === 0 ? { ...s, on: true, throttle: 0.5 } : s,
      ),
    };
    expect(groupAnyOn(w, vehicle, "centre")).toBe(true);
    expect(groupThrottle(w, vehicle, "centre")).toBeCloseTo(0.5 / 3, 6);
  });
});

describe("fuelFraction", () => {
  it("at the bootstrap scenario the tank is ~30% full", () => {
    const f = fuelFraction(baseWorld);
    expect(f).toBeGreaterThan(0.25);
    expect(f).toBeLessThan(0.35);
  });
});

describe("towerProximity", () => {
  it("rocket directly above the tower base: horizontal dist = 0", () => {
    const w = withPosition({ x: 0, y: 800, z: 0 });
    const p = towerProximity(w);
    expect(p.distHoriz).toBeCloseTo(0, 6);
    expect(p.dist3d).toBeCloseTo(800, 6);
  });
  it("rocket offset east: bearing ~ 0 rad", () => {
    const w = withPosition({ x: 100, y: 0, z: 0 });
    const p = towerProximity(w);
    expect(p.bearingRad).toBeCloseTo(0, 6);
    expect(p.distHoriz).toBeCloseTo(100, 6);
  });
});

describe("predictedImpact", () => {
  it("a stationary booster at 800 m above ground hits the pad in ~13 s of free fall", () => {
    const w: World = {
      ...baseWorld,
      rigidBody: {
        ...baseWorld.rigidBody,
        position: Vec3.of(0, 800, 0),
        velocity: Vec3.of(0, 0, 0),
        attitude: Quat.IDENTITY,
        angularVelocity: Vec3.of(0, 0, 0),
      },
    };
    const impact = predictedImpact(w, vehicle, { dt: 0.05, maxT: 60 });
    expect(impact).not.toBeNull();
    expect(impact!.y).toBeCloseTo(0, 1);
    // Allow some drift due to drag and the integrator; impact should be
    // close to under the booster.
    expect(Math.hypot(impact!.x, impact!.z)).toBeLessThan(30);
  });

  it("returns null when the booster is already on the ground", () => {
    const w = withPosition({ x: 0, y: 0, z: 0 });
    const impact = predictedImpact(w, vehicle);
    expect(impact).toEqual(w.rigidBody.position);
  });
});
