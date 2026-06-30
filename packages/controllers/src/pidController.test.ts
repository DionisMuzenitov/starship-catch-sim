import { describe, expect, it } from "vitest";

import {
  BoosterDescentCalm,
  Vec3,
  simStep,
  type ControlInput,
} from "@starship-catch-sim/physics";

import {
  DEFAULT_PID_GAINS,
  PIDController,
  type PIDControllerGains,
} from "./pidController.js";

function makeController(
  gainsOverride?: Partial<PIDControllerGains>,
): PIDController {
  const gains: PIDControllerGains = { ...DEFAULT_PID_GAINS, ...gainsOverride };
  return new PIDController(
    BoosterDescentCalm.vehicle,
    BoosterDescentCalm.targetCatch.targetPosition,
    () => gains,
  );
}

function isFiniteControl(ctl: ControlInput): boolean {
  return (
    Number.isFinite(ctl.gimbalPitch) &&
    Number.isFinite(ctl.gimbalYaw) &&
    Number.isFinite(ctl.engineGroups.centre) &&
    Number.isFinite(ctl.engineGroups.inner) &&
    Number.isFinite(ctl.engineGroups.outer)
  );
}

describe("PIDController", () => {
  it("emits a finite, in-clamp ControlInput on every step over 10 seconds", () => {
    const pid = makeController();
    let world = BoosterDescentCalm.initialWorld;
    const dt = 1 / 250;
    for (let i = 0; i < 2500; i++) {
      const ctl = pid.step(world, dt);
      expect(isFiniteControl(ctl)).toBe(true);
      expect(ctl.gimbalPitch).toBeGreaterThanOrEqual(-0.35);
      expect(ctl.gimbalPitch).toBeLessThanOrEqual(0.35);
      expect(ctl.gimbalYaw).toBeGreaterThanOrEqual(-0.35);
      expect(ctl.gimbalYaw).toBeLessThanOrEqual(0.35);
      for (const g of ["centre", "inner", "outer"] as const) {
        expect(ctl.engineGroups[g]).toBeGreaterThanOrEqual(0);
        expect(ctl.engineGroups[g]).toBeLessThanOrEqual(1);
      }
      world = simStep(
        world,
        BoosterDescentCalm.vehicle,
        ctl,
        dt,
        BoosterDescentCalm.env,
      );
    }
  });

  it("keeps engines off above the ignition altitude (initial 65 km)", () => {
    const pid = makeController({ ignitionAltitudeM: 6_000 });
    const ctl = pid.step(BoosterDescentCalm.initialWorld, 1 / 250);
    expect(ctl.enginesOn.centre).toBe(false);
    expect(ctl.enginesOn.inner).toBe(false);
    expect(ctl.enginesOn.outer).toBe(false);
  });

  it("ignites and commands throttle when below ignition + descending faster than profile", () => {
    const pid = makeController({ ignitionAltitudeM: 6_000 });
    // Falling fast enough that the suicide-burn profile wants to brake.
    const w = {
      ...BoosterDescentCalm.initialWorld,
      rigidBody: {
        ...BoosterDescentCalm.initialWorld.rigidBody,
        position: Vec3.of(0, 3_000, 0),
        velocity: Vec3.of(0, -700, 0),
      },
    };
    const ctl = pid.step(w, 1 / 250);
    expect(ctl.enginesOn.centre).toBe(true);
    expect(ctl.engineGroups.centre).toBeGreaterThan(0);
  });

  it("reset() clears the altitude integrator between runs", () => {
    const pid = makeController({ ignitionAltitudeM: 100_000 });
    // Hold the world inside the active band: low altitude, hovering. The
    // altitude PID will accumulate integrator as it tries to track the
    // shallow vy profile.
    const w = {
      ...BoosterDescentCalm.initialWorld,
      rigidBody: {
        ...BoosterDescentCalm.initialWorld.rigidBody,
        position: Vec3.of(0, 200, 0),
        velocity: Vec3.of(0, -5, 0),
      },
    };
    for (let i = 0; i < 200; i++) pid.step(w, 1 / 250);
    let lastAltCmd = 0;
    pid.setObserver((f) => {
      lastAltCmd = f.altitude.command;
    });
    pid.step(w, 1 / 250);
    const warmAlt = lastAltCmd;
    pid.reset();
    pid.step(w, 1 / 250);
    const freshAlt = lastAltCmd;
    expect(freshAlt).not.toBe(warmAlt);
  });

  it("calls observer with a frame on every step", () => {
    const pid = makeController();
    const frames: number[] = [];
    pid.setObserver((f) => frames.push(f.t));
    let world = BoosterDescentCalm.initialWorld;
    for (let i = 0; i < 5; i++) {
      pid.step(world, 1 / 250);
      world = { ...world, t: world.t + 1 / 250 };
    }
    expect(frames.length).toBe(5);
  });
});
