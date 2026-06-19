import {
  BoosterDescentStandard,
  DEFAULT_TOWER_STATE,
  Vec3,
  boosterDescentScenario,
  chopstickCaptureVolume,
  createRecorder,
  neutralControl,
  type CatchOutcome,
  type ControlInput,
  type Replay,
  type World,
} from "@starship-catch-sim/physics";
import type { Controller } from "@starship-catch-sim/controllers";
import { describe, expect, it } from "vitest";

import { SimRunner } from "./runner";

const FIN_COUNT = 4;

class FullThrottle implements Controller {
  private readonly base = neutralControl(FIN_COUNT, 0);
  step(): ControlInput {
    return {
      ...this.base,
      engineGroups: { centre: 1, inner: 1, outer: 1, ship: 0 },
      enginesOn: { centre: true, inner: true, outer: true, ship: false },
    };
  }
}

class Idle implements Controller {
  private readonly base = neutralControl(FIN_COUNT, 0);
  step(): ControlInput {
    return this.base;
  }
}

function runnerFor(controller: Controller) {
  const scenario = boosterDescentScenario();
  const runner = new SimRunner({
    vehicle: scenario.vehicle,
    initialWorld: scenario.initialWorld,
    controller,
    callbacks: { onRender: () => undefined },
  });
  return { runner, scenario };
}

describe("SimRunner smoke", () => {
  it("paused runner does nothing on advance", () => {
    const { runner, scenario } = runnerFor(new Idle());
    runner.advance(1);
    expect(runner.getWorld().t).toBe(0);
    expect(runner.getWorld().rigidBody.position.y).toBe(
      scenario.initialWorld.rigidBody.position.y,
    );
  });

  it("unpaused full-throttle changes altitude over 1 sim second", () => {
    const { runner, scenario } = runnerFor(new FullThrottle());
    runner.setPaused(false);
    runner.advance(1);
    const y0 = scenario.initialWorld.rigidBody.position.y;
    const y1 = runner.getWorld().rigidBody.position.y;
    expect(Math.abs(y1 - y0)).toBeGreaterThan(1);
    expect(runner.getWorld().t).toBeGreaterThan(0.5);
  });

  it("scale ×2 advances sim time twice as far for the same real time", () => {
    const a = runnerFor(new Idle());
    const b = runnerFor(new Idle());
    a.runner.setPaused(false);
    b.runner.setPaused(false);
    b.runner.scaleUp();
    a.runner.advance(0.5);
    b.runner.advance(0.5);
    expect(b.runner.getWorld().t).toBeGreaterThan(a.runner.getWorld().t * 1.5);
  });

  it("reset returns to the scenario initial conditions", () => {
    const { runner, scenario } = runnerFor(new FullThrottle());
    runner.setPaused(false);
    runner.advance(0.5);
    expect(runner.getWorld().t).toBeGreaterThan(0);
    runner.reset();
    expect(runner.getWorld().t).toBe(0);
    expect(runner.getWorld().rigidBody.position.y).toBe(
      scenario.initialWorld.rigidBody.position.y,
    );
  });

  it("rewind 5s steps back to an earlier snapshot", () => {
    const { runner } = runnerFor(new FullThrottle());
    runner.setPaused(false);
    runner.advance(10);
    const tAfter = runner.getWorld().t;
    runner.rewind(5);
    const tRewound = runner.getWorld().t;
    expect(tRewound).toBeLessThan(tAfter);
    expect(tAfter - tRewound).toBeGreaterThan(3);
    expect(tAfter - tRewound).toBeLessThan(7);
  });
});

describe("SimRunner — catch outcome plumbing", () => {
  it("rocket starting inside the capture volume at rest reports caught + freezes", () => {
    const scenario = BoosterDescentStandard;
    const capture = chopstickCaptureVolume(DEFAULT_TOWER_STATE);
    const inCatchInitial: World = {
      ...scenario.initialWorld,
      rigidBody: {
        ...scenario.initialWorld.rigidBody,
        position: capture.center,
        velocity: Vec3.ZERO,
        attitude: { x: 0, y: 0, z: 0, w: 1 },
        angularVelocity: Vec3.ZERO,
      },
    };
    const outcomes: CatchOutcome[] = [];
    const runner = new SimRunner({
      vehicle: scenario.vehicle,
      initialWorld: inCatchInitial,
      controller: new Idle(),
      env: scenario.env,
      catchEnvelope: scenario.targetCatch,
      callbacks: {
        onRender: () => undefined,
        onOutcome: (o) => outcomes.push(o),
      },
    });
    runner.setPaused(false);
    runner.advance(0.1);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.kind).toBe("caught");
    // After the outcome fires, further advances must not change t.
    const t1 = runner.getWorld().t;
    runner.advance(1);
    expect(runner.getWorld().t).toBe(t1);
    // World pose was snapped to the catch target.
    expect(runner.getWorld().rigidBody.position).toEqual(
      scenario.targetCatch.targetPosition,
    );
  });

  it("zero-input booster eventually fires a non-caught outcome", () => {
    const scenario = BoosterDescentStandard;
    const outcomes: CatchOutcome[] = [];
    const runner = new SimRunner({
      vehicle: scenario.vehicle,
      initialWorld: scenario.initialWorld,
      controller: new Idle(),
      env: scenario.env,
      catchEnvelope: scenario.targetCatch,
      callbacks: {
        onRender: () => undefined,
        onOutcome: (o) => outcomes.push(o),
      },
    });
    runner.setPaused(false);
    // 5 minutes of sim time is well past free-fall ground impact.
    runner.advance(300);
    expect(outcomes).toHaveLength(1);
    // From the (0, 65 km, 50 km) start with retrograde attitude the rocket
    // doesn't land in the capture volume — expect ground impact (crash).
    expect(["crash", "near_miss", "tower_collision"]).toContain(
      outcomes[0]!.kind,
    );
  });

  it("recorder receives frames and finalises on outcome", () => {
    const scenario = BoosterDescentStandard;
    const replays: Replay[] = [];
    const recorder = createRecorder({
      scenarioId: scenario.id,
      vehicleId: "booster",
      frameRateHz: 50,
      createdAt: "2026-06-19T12:00:00.000Z",
    });
    const runner = new SimRunner({
      vehicle: scenario.vehicle,
      initialWorld: scenario.initialWorld,
      controller: new Idle(),
      env: scenario.env,
      catchEnvelope: scenario.targetCatch,
      recorder,
      callbacks: {
        onRender: () => undefined,
        onReplay: (r) => replays.push(r),
      },
    });
    runner.setPaused(false);
    runner.advance(300);
    expect(replays).toHaveLength(1);
    const replay = replays[0]!;
    expect(replay.header.scenarioId).toBe(scenario.id);
    expect(replay.header.frameRateHz).toBe(50);
    expect(replay.header.outcome).not.toBeNull();
    expect(replay.frames.length).toBeGreaterThan(10);
    // Frame timestamps are monotonic.
    for (let i = 1; i < replay.frames.length; i++) {
      expect(replay.frames[i]!.t).toBeGreaterThanOrEqual(
        replay.frames[i - 1]!.t,
      );
    }
  });

  it("with no catchEnvelope passed, no outcome ever fires", () => {
    const scenario = BoosterDescentStandard;
    const outcomes: CatchOutcome[] = [];
    const runner = new SimRunner({
      vehicle: scenario.vehicle,
      initialWorld: scenario.initialWorld,
      controller: new Idle(),
      env: scenario.env,
      callbacks: {
        onRender: () => undefined,
        onOutcome: (o) => outcomes.push(o),
      },
    });
    runner.setPaused(false);
    runner.advance(300);
    expect(outcomes).toHaveLength(0);
  });
});
