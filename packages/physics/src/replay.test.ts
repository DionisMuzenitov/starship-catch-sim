import { describe, expect, it } from "vitest";

import { neutralControl } from "./control.js";
import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";
import {
  REPLAY_SCHEMA_VERSION,
  createRecorder,
  interpolateReplay,
  parseReplay,
  serializeReplay,
} from "./replay.js";
import { BoosterDescentStandard } from "./scenarios.js";
import type { ControlInput } from "./control.js";
import type { World } from "./world.js";

const CREATED_AT = "2026-06-19T12:00:00.000Z";
const BASE = BoosterDescentStandard.initialWorld;
const CTL = neutralControl(4, 0);

function worldAt(t: number, pos: Vec3, vel: Vec3): World {
  return {
    ...BASE,
    t,
    rigidBody: {
      ...BASE.rigidBody,
      position: pos,
      velocity: vel,
    },
  };
}

function mkRecorder(frameRateHz = 100) {
  return createRecorder({
    scenarioId: "booster-descent-standard",
    vehicleId: "booster",
    frameRateHz,
    createdAt: CREATED_AT,
  });
}

describe("createRecorder", () => {
  it("downsamples a 250 Hz tick stream to the configured cadence", () => {
    const rec = mkRecorder(100);
    const physicsDt = 1 / 250;
    for (let i = 0; i < 1000; i++) {
      rec.push(i * physicsDt, worldAt(i * physicsDt, Vec3.ZERO, Vec3.ZERO), CTL);
    }
    // 1000 ticks × 4 ms = 4 s of sim. At 100 Hz cadence that's ~400 frames.
    // Allow ±2 for boundary effects (first sample always lands).
    expect(rec.frameCount()).toBeGreaterThanOrEqual(398);
    expect(rec.frameCount()).toBeLessThanOrEqual(402);
  });

  it("finalize stamps the header with outcome, duration, and schemaVersion", () => {
    const rec = mkRecorder();
    rec.push(0, worldAt(0, Vec3.ZERO, Vec3.ZERO), CTL);
    rec.push(0.5, worldAt(0.5, Vec3.of(0, -10, 0), Vec3.of(0, -20, 0)), CTL);
    rec.push(1.0, worldAt(1.0, Vec3.of(0, -30, 0), Vec3.of(0, -20, 0)), CTL);
    const replay = rec.finalize({
      kind: "crash",
      metrics: {
        position: Vec3.ZERO,
        velocity: Vec3.ZERO,
        verticalSpeedMps: -20,
        horizontalSpeedMps: 0,
        tiltRad: 0,
        angularRateMagRadPerS: 0,
        fuelRemainingKg: 1000,
        distanceToTargetM: 50,
      },
    });
    expect(replay.header.schemaVersion).toBe(REPLAY_SCHEMA_VERSION);
    expect(replay.header.scenarioId).toBe("booster-descent-standard");
    expect(replay.header.vehicleId).toBe("booster");
    expect(replay.header.outcome?.kind).toBe("crash");
    expect(replay.header.durationS).toBeCloseTo(1.0, 6);
    expect(replay.header.createdAt).toBe(CREATED_AT);
  });

  it("frameCount of an unpushed recorder is zero", () => {
    expect(mkRecorder().frameCount()).toBe(0);
  });
});

describe("interpolateReplay", () => {
  function fixture() {
    const rec = mkRecorder(10); // sparse cadence makes intervals easy to read
    rec.push(0.0, worldAt(0.0, Vec3.of(0, 100, 0), Vec3.of(0, -10, 0)), CTL);
    rec.push(0.1, worldAt(0.1, Vec3.of(0, 99, 0), Vec3.of(0, -10, 0)), CTL);
    rec.push(0.2, worldAt(0.2, Vec3.of(0, 98, 0), Vec3.of(0, -10, 0)), CTL);
    rec.push(0.3, worldAt(0.3, Vec3.of(0, 97, 0), Vec3.of(0, -10, 0)), CTL);
    return rec.finalize(null);
  }

  it("returns the first frame for t below range", () => {
    const r = fixture();
    const { world } = interpolateReplay(r, -1);
    expect(world.rigidBody.position.y).toBe(100);
  });

  it("returns the last frame for t above range", () => {
    const r = fixture();
    const { world } = interpolateReplay(r, 999);
    expect(world.rigidBody.position.y).toBe(97);
  });

  it("lerps position between bracket frames", () => {
    const r = fixture();
    const { world } = interpolateReplay(r, 0.15);
    // Half-way between y=99 (t=0.1) and y=98 (t=0.2) → 98.5.
    expect(world.rigidBody.position.y).toBeCloseTo(98.5, 6);
  });

  it("snapshots controlInput from the earlier bracket frame", () => {
    const rec = mkRecorder(10);
    const ctlA: ControlInput = { ...CTL, gimbalPitch: 0.1 };
    const ctlB: ControlInput = { ...CTL, gimbalPitch: 0.4 };
    rec.push(0.0, worldAt(0.0, Vec3.of(0, 100, 0), Vec3.ZERO), ctlA);
    rec.push(0.1, worldAt(0.1, Vec3.of(0, 99, 0), Vec3.ZERO), ctlB);
    const replay = rec.finalize(null);
    const { controlInput } = interpolateReplay(replay, 0.05);
    expect(controlInput.gimbalPitch).toBe(0.1);
  });
});

describe("serialize / parse round-trip", () => {
  it("preserves frame timestamps and positions through JSON", () => {
    const rec = mkRecorder(50);
    for (let i = 0; i < 20; i++) {
      const t = i * 0.02;
      rec.push(
        t,
        worldAt(t, Vec3.of(0, 100 - i, 0), Vec3.of(0, -50, 0)),
        CTL,
      );
    }
    const original = rec.finalize(null);
    const round = parseReplay(serializeReplay(original));
    expect(round.frames.length).toBe(original.frames.length);
    for (let i = 0; i < round.frames.length; i++) {
      const a = original.frames[i]!;
      const b = round.frames[i]!;
      expect(b.t).toBe(a.t);
      expect(b.world.rigidBody.position.y).toBe(a.world.rigidBody.position.y);
      expect(b.world.rigidBody.attitude.w).toBe(a.world.rigidBody.attitude.w);
    }
    // The interpolator should agree across both copies too.
    const midA = interpolateReplay(original, 0.21);
    const midB = interpolateReplay(round, 0.21);
    expect(midB.world.rigidBody.position.y).toBeCloseTo(
      midA.world.rigidBody.position.y,
      6,
    );
  });

  it("rejects an unsupported schemaVersion", () => {
    const rec = mkRecorder();
    rec.push(0, worldAt(0, Vec3.ZERO, Vec3.ZERO), CTL);
    const replay = rec.finalize(null);
    const munged = serializeReplay({
      ...replay,
      header: { ...replay.header, schemaVersion: 999 },
    });
    expect(() => parseReplay(munged)).toThrow(/schemaVersion/);
  });

  it("rejects an empty frames array", () => {
    expect(() =>
      parseReplay(
        JSON.stringify({
          header: {
            schemaVersion: REPLAY_SCHEMA_VERSION,
            scenarioId: "booster-descent-standard",
            vehicleId: "booster",
            seed: null,
            outcome: null,
            durationS: 0,
            frameRateHz: 100,
            createdAt: CREATED_AT,
          },
          frames: [],
        }),
      ),
    ).toThrow(/frames/);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseReplay("{not json")).toThrow(/invalid JSON/);
  });

  it("rejects a non-object root", () => {
    expect(() => parseReplay("42")).toThrow(/object at the root/);
    expect(() => parseReplay("null")).toThrow(/object at the root/);
  });

  it("rejects a missing or non-object header", () => {
    expect(() => parseReplay(JSON.stringify({ frames: [] }))).toThrow(
      /missing header/,
    );
  });

  it("rejects a non-array frames field", () => {
    expect(() =>
      parseReplay(
        JSON.stringify({
          header: {
            schemaVersion: REPLAY_SCHEMA_VERSION,
            scenarioId: "x",
            vehicleId: "booster",
            seed: null,
            outcome: null,
            durationS: 0,
            frameRateHz: 100,
            createdAt: CREATED_AT,
          },
          frames: "nope",
        }),
      ),
    ).toThrow(/frames array/);
  });

  it("rejects a non-string or empty scenarioId / vehicleId", () => {
    const base = {
      schemaVersion: REPLAY_SCHEMA_VERSION,
      seed: null,
      outcome: null,
      durationS: 0,
      frameRateHz: 100,
      createdAt: CREATED_AT,
    };
    expect(() =>
      parseReplay(
        JSON.stringify({
          header: { ...base, scenarioId: "", vehicleId: "booster" },
          frames: [{}],
        }),
      ),
    ).toThrow(/scenarioId/);
    expect(() =>
      parseReplay(
        JSON.stringify({
          header: { ...base, scenarioId: "x", vehicleId: 0 },
          frames: [{}],
        }),
      ),
    ).toThrow(/vehicleId/);
  });

  it("rejects a non-positive frameRateHz", () => {
    expect(() =>
      parseReplay(
        JSON.stringify({
          header: {
            schemaVersion: REPLAY_SCHEMA_VERSION,
            scenarioId: "x",
            vehicleId: "booster",
            seed: null,
            outcome: null,
            durationS: 0,
            frameRateHz: 0,
            createdAt: CREATED_AT,
          },
          frames: [{}],
        }),
      ),
    ).toThrow(/frameRateHz/);
  });
});

describe("interpolateReplay edge cases", () => {
  it("returns the only frame for a single-frame replay", () => {
    const rec = mkRecorder(10);
    rec.push(0.5, worldAt(0.5, Vec3.of(0, 42, 0), Vec3.ZERO), CTL);
    const r = rec.finalize(null);
    const { world } = interpolateReplay(r, 0.7);
    expect(world.rigidBody.position.y).toBe(42);
  });

  it("throws on an empty replay", () => {
    const rec = mkRecorder(10);
    const r = rec.finalize(null);
    expect(() => interpolateReplay(r, 0)).toThrow(/no frames/);
  });
});

describe("interpolateReplay quaternion math", () => {
  it("slerps attitude between bracket frames", () => {
    const rec = mkRecorder(10);
    const a = Quat.IDENTITY;
    const b = Quat.fromAxisAngle(Vec3.of(0, 0, 1), Math.PI / 2);
    rec.push(0.0, { ...BASE, t: 0, rigidBody: { ...BASE.rigidBody, attitude: a } }, CTL);
    rec.push(0.1, { ...BASE, t: 0.1, rigidBody: { ...BASE.rigidBody, attitude: b } }, CTL);
    const replay = rec.finalize(null);
    const { world } = interpolateReplay(replay, 0.05);
    // Half-way between identity and π/2 about Z → π/4 about Z.
    const expected = Quat.fromAxisAngle(Vec3.of(0, 0, 1), Math.PI / 4);
    expect(world.rigidBody.attitude.w).toBeCloseTo(expected.w, 4);
    expect(world.rigidBody.attitude.z).toBeCloseTo(expected.z, 4);
  });
});
