import { describe, expect, it } from "vitest";

import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";
import { currentPhase } from "./phase.js";
import { ShipDescentStandard } from "./scenarios.js";
import type { World } from "./world.js";

function makeWorld(altitudeM: number, attitude: Quat): World {
  const base = ShipDescentStandard.initialWorld;
  return {
    ...base,
    rigidBody: {
      ...base.rigidBody,
      position: Vec3.of(0, altitudeM, 0),
      velocity: Vec3.ZERO,
      attitude,
      angularVelocity: Vec3.ZERO,
    },
  };
}

describe("currentPhase", () => {
  it("alt above 50 km classifies as entry, regardless of pose", () => {
    expect(currentPhase(makeWorld(80_000, Quat.IDENTITY))).toBe("entry");
    const horizontal = Quat.fromAxisAngle(Vec3.of(0, 0, 1), -Math.PI / 2);
    expect(currentPhase(makeWorld(80_000, horizontal))).toBe("entry");
  });

  it("alt below 1 km classifies as catch_attempt, regardless of pose", () => {
    expect(currentPhase(makeWorld(500, Quat.IDENTITY))).toBe("catch_attempt");
    const horizontal = Quat.fromAxisAngle(Vec3.of(0, 0, 1), -Math.PI / 2);
    expect(currentPhase(makeWorld(500, horizontal))).toBe("catch_attempt");
  });

  it("mid altitude, body horizontal → belly_flop", () => {
    const horizontal = Quat.fromAxisAngle(Vec3.of(0, 0, 1), -Math.PI / 2);
    expect(currentPhase(makeWorld(20_000, horizontal))).toBe("belly_flop");
  });

  it("mid altitude, tilted ~45° → flip", () => {
    const tilted = Quat.fromAxisAngle(Vec3.of(0, 0, 1), -Math.PI / 4);
    expect(currentPhase(makeWorld(10_000, tilted))).toBe("flip");
  });

  it("mid altitude, upright → vertical", () => {
    expect(currentPhase(makeWorld(5_000, Quat.IDENTITY))).toBe("vertical");
  });

  it("threshold edges: 70°+ε is belly_flop, just below is flip", () => {
    const just_above_70 = Quat.fromAxisAngle(
      Vec3.of(0, 0, 1),
      -(71 * Math.PI) / 180,
    );
    const just_below_70 = Quat.fromAxisAngle(
      Vec3.of(0, 0, 1),
      -(69 * Math.PI) / 180,
    );
    expect(currentPhase(makeWorld(10_000, just_above_70))).toBe("belly_flop");
    expect(currentPhase(makeWorld(10_000, just_below_70))).toBe("flip");
  });

  it("threshold edges: 20°+ε is flip, just below is vertical", () => {
    const just_above_20 = Quat.fromAxisAngle(
      Vec3.of(0, 0, 1),
      -(21 * Math.PI) / 180,
    );
    const just_below_20 = Quat.fromAxisAngle(
      Vec3.of(0, 0, 1),
      -(19 * Math.PI) / 180,
    );
    expect(currentPhase(makeWorld(10_000, just_above_20))).toBe("flip");
    expect(currentPhase(makeWorld(10_000, just_below_20))).toBe("vertical");
  });
});
