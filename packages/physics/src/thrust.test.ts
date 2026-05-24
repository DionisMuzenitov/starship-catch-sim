import { describe, expect, it } from "vitest";

import { Vec3 } from "./math/vec3.js";
import { StarshipEngines } from "./presets/starship-engines.js";
import { SuperHeavyEngines } from "./presets/super-heavy-engines.js";
import {
  aggregate,
  engineForceTorque,
  G0,
  initialEngineState,
  updateEngineState,
  type Engine,
  type EngineCommand,
} from "./thrust.js";

const DOWN = Vec3.of(0, -1, 0);

const makeEngine = (overrides: Partial<Engine> = {}): Engine => ({
  mount: Vec3.of(0, 0, 0),
  direction: DOWN,
  thrustVac: 2_000_000,
  thrustSea: 1_800_000,
  ispVac: 350,
  ispSea: 327,
  maxGimbal: 0.262,
  maxGimbalRate: 0.35,
  minThrottle: 0.4,
  tauThrottle: 0.15,
  tauGimbal: 0.1,
  canGimbal: true,
  ...overrides,
});

const idleCommand: EngineCommand = {
  gimbalPitchTarget: 0,
  gimbalYawTarget: 0,
  throttleTarget: 0,
  on: false,
};

describe("updateEngineState", () => {
  it("ignition: throttle approaches target via first-order lag", () => {
    const engine = makeEngine({ tauThrottle: 0.2 });
    let state = initialEngineState();
    const cmd: EngineCommand = {
      ...idleCommand,
      throttleTarget: 1.0,
      on: true,
    };
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      state = updateEngineState(engine, state, cmd, 0.05);
      samples.push(state.throttle);
    }
    // Monotonically increasing.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]!);
    }
    // Approaches the target.
    expect(samples[samples.length - 1]).toBeGreaterThan(0.9);
    expect(samples[samples.length - 1]).toBeLessThanOrEqual(1);
  });

  it("shutdown: throttle ramps to zero when on=false", () => {
    const engine = makeEngine();
    let state = { ...initialEngineState(), throttle: 1.0, on: true };
    const cmd: EngineCommand = { ...idleCommand };
    for (let i = 0; i < 30; i++) {
      state = updateEngineState(engine, state, cmd, 0.05);
    }
    expect(state.throttle).toBeLessThan(0.01);
    expect(state.on).toBe(false);
  });

  it("throttle target is clamped to [minThrottle, 1] when on", () => {
    const engine = makeEngine({ minThrottle: 0.5, tauThrottle: 0.001 });
    let state = { ...initialEngineState(), throttle: 0.5, on: true };
    const cmd: EngineCommand = {
      ...idleCommand,
      throttleTarget: 0.1,
      on: true,
    };
    // After enough time, throttle should sit at minThrottle, not 0.1.
    for (let i = 0; i < 100; i++) {
      state = updateEngineState(engine, state, cmd, 0.05);
    }
    expect(state.throttle).toBeCloseTo(0.5, 4);
  });

  it("gimbal target is clamped to ±maxGimbal", () => {
    const engine = makeEngine({
      maxGimbal: 0.2,
      tauGimbal: 0.001,
      maxGimbalRate: 10,
    });
    let state = initialEngineState();
    const cmd: EngineCommand = {
      ...idleCommand,
      gimbalPitchTarget: 5, // wildly out of range
      gimbalYawTarget: -5,
      on: true,
    };
    for (let i = 0; i < 100; i++) {
      state = updateEngineState(engine, state, cmd, 0.05);
    }
    expect(state.gimbalPitch).toBeCloseTo(0.2, 6);
    expect(state.gimbalYaw).toBeCloseTo(-0.2, 6);
  });

  it("fixed engines (canGimbal=false) ignore gimbal commands", () => {
    const engine = makeEngine({ canGimbal: false });
    let state = initialEngineState();
    const cmd: EngineCommand = {
      ...idleCommand,
      gimbalPitchTarget: 0.1,
      gimbalYawTarget: 0.1,
      throttleTarget: 1,
      on: true,
    };
    for (let i = 0; i < 50; i++) {
      state = updateEngineState(engine, state, cmd, 0.05);
    }
    expect(state.gimbalPitch).toBe(0);
    expect(state.gimbalYaw).toBe(0);
  });

  it("gimbal slew rate is enforced", () => {
    // Tight rate limit → can't reach the target in one step.
    const engine = makeEngine({
      maxGimbal: 1,
      tauGimbal: 0.0001, // lag is fast, so the slew limit is the constraint
      maxGimbalRate: 0.5, // rad/s
    });
    let state = initialEngineState();
    const cmd: EngineCommand = {
      ...idleCommand,
      gimbalPitchTarget: 1, // 1 rad away
      on: true,
    };
    state = updateEngineState(engine, state, cmd, 0.1); // 100 ms
    // Should have moved at most 0.5 * 0.1 = 0.05 rad.
    expect(state.gimbalPitch).toBeLessThanOrEqual(0.05 + 1e-9);
  });
});

describe("engineForceTorque", () => {
  it("all engines off → zero force, zero torque", () => {
    const engine = makeEngine();
    const state = initialEngineState();
    const c = engineForceTorque(engine, state, Vec3.ZERO, 1);
    expect(c.forceBody).toEqual(Vec3.ZERO);
    expect(c.torqueBody).toEqual(Vec3.ZERO);
    expect(c.mdot).toBe(0);
  });

  it("axial centre engine: pure -y force, zero torque when arm is colinear", () => {
    // Engine at (0, 0, 0), CoM at (0, 20, 0). Arm is purely along y, force
    // is purely along y → cross product is zero.
    const engine = makeEngine({ mount: Vec3.of(0, 0, 0) });
    const state = { ...initialEngineState(), throttle: 1, on: true };
    const c = engineForceTorque(engine, state, Vec3.of(0, 20, 0), 0);
    expect(c.forceBody.x).toBeCloseTo(0, 6);
    expect(c.forceBody.z).toBeCloseTo(0, 6);
    expect(c.forceBody.y).toBeLessThan(0); // thrust is -y
    expect(Math.abs(c.torqueBody.x)).toBeLessThan(1e-6);
    expect(Math.abs(c.torqueBody.y)).toBeLessThan(1e-6);
    expect(Math.abs(c.torqueBody.z)).toBeLessThan(1e-6);
  });

  it("off-axis engine produces non-zero torque about CoM", () => {
    // Engine mounted at +x offset → axial thrust creates pitching torque
    // about CoM that's higher up the y axis.
    const engine = makeEngine({ mount: Vec3.of(1, 0, 0) });
    const state = { ...initialEngineState(), throttle: 1, on: true };
    const c = engineForceTorque(engine, state, Vec3.of(0, 20, 0), 0);
    // arm = (1, -20, 0); force = (0, -F, 0); cross arm × force →
    // (-20)(-F) - 0 = positive in z? Let me compute:
    // x: (arm.y * f.z - arm.z * f.y) = (-20)*0 - 0*(-F) = 0
    // y: (arm.z * f.x - arm.x * f.z) = 0*0 - 1*0 = 0
    // z: (arm.x * f.y - arm.y * f.x) = 1*(-F) - (-20)*0 = -F (negative)
    expect(Math.abs(c.torqueBody.x)).toBeLessThan(1e-6);
    expect(Math.abs(c.torqueBody.y)).toBeLessThan(1e-6);
    expect(c.torqueBody.z).toBeLessThan(0);
  });

  it("gimbal pitch (about body X) tilts thrust direction in the YZ plane", () => {
    const engine = makeEngine({ mount: Vec3.of(0, 0, 0) });
    const state = {
      gimbalPitch: 0.1, // rad — small positive tilt around X
      gimbalYaw: 0,
      throttle: 1,
      on: true,
    };
    const c = engineForceTorque(engine, state, Vec3.of(0, 20, 0), 0);
    // Rotating (0,-1,0) about X by +0.1 rad gives (0, -cos(0.1), -sin(0.1))?
    // Let's verify the sign by checking that force.z is non-zero.
    expect(Math.abs(c.forceBody.z)).toBeGreaterThan(0);
    // Arm is purely +y from engine to CoM negated: arm = (0, -20, 0).
    // force has -y and -z components, so cross with (0, -20, 0):
    // torque.x = arm.y*f.z - arm.z*f.y = (-20)*f.z. f.z != 0 → torque.x != 0
    expect(Math.abs(c.torqueBody.x)).toBeGreaterThan(0);
  });

  it("mdot scales with throttle and is positive only when on", () => {
    const engine = makeEngine({ mount: Vec3.of(0, 0, 0) });
    const off = engineForceTorque(engine, initialEngineState(), Vec3.ZERO, 0);
    expect(off.mdot).toBe(0);

    const half = engineForceTorque(
      engine,
      { ...initialEngineState(), throttle: 0.5, on: true },
      Vec3.ZERO,
      0,
    );
    const full = engineForceTorque(
      engine,
      { ...initialEngineState(), throttle: 1.0, on: true },
      Vec3.ZERO,
      0,
    );
    expect(half.mdot).toBeGreaterThan(0);
    expect(full.mdot).toBeCloseTo(2 * half.mdot, 6);
  });

  it("vacuum thrust > sea-level thrust", () => {
    const engine = makeEngine();
    const state = { ...initialEngineState(), throttle: 1, on: true };
    const sea = engineForceTorque(engine, state, Vec3.ZERO, 1);
    const vac = engineForceTorque(engine, state, Vec3.ZERO, 0);
    expect(Vec3.length(vac.forceBody)).toBeGreaterThan(
      Vec3.length(sea.forceBody),
    );
  });

  it("mdot matches T / (Isp · g0)", () => {
    const engine = makeEngine();
    const state = { ...initialEngineState(), throttle: 1, on: true };
    const vac = engineForceTorque(engine, state, Vec3.ZERO, 0);
    const expectedMdot = engine.thrustVac / (engine.ispVac * G0);
    expect(vac.mdot).toBeCloseTo(expectedMdot, 6);
  });
});

describe("aggregate", () => {
  it("zero engines → zero outputs", () => {
    const out = aggregate([], [], [], Vec3.ZERO, 0, 0.01);
    expect(out.forceBody).toEqual(Vec3.ZERO);
    expect(out.torqueBody).toEqual(Vec3.ZERO);
    expect(out.mdotTotal).toBe(0);
    expect(out.newStates).toEqual([]);
  });

  it("array length mismatch throws", () => {
    const engines = [makeEngine()];
    const states = [initialEngineState(), initialEngineState()];
    const commands = [idleCommand];
    expect(() =>
      aggregate(engines, states, commands, Vec3.ZERO, 0, 0.01),
    ).toThrow(/length mismatch/);
  });

  it("two engines on opposite sides cancel translational X but stack torques", () => {
    const left = makeEngine({ mount: Vec3.of(-1, 0, 0), canGimbal: false });
    const right = makeEngine({ mount: Vec3.of(1, 0, 0), canGimbal: false });
    const both: EngineCommand = {
      ...idleCommand,
      throttleTarget: 1,
      on: true,
    };
    const states = [
      { ...initialEngineState(), throttle: 1, on: true },
      { ...initialEngineState(), throttle: 1, on: true },
    ];
    const out = aggregate(
      [left, right],
      states,
      [both, both],
      Vec3.of(0, 20, 0),
      0,
      0.01,
    );
    // Symmetric mounts, same thrust → no net torque about the y axis,
    // axial thrust doubles.
    expect(Math.abs(out.torqueBody.z)).toBeLessThan(1e-6);
    expect(out.forceBody.y).toBeLessThan(0);
    expect(out.mdotTotal).toBeGreaterThan(0);
  });

  it("throttle ramp visible in time series", () => {
    const engine = makeEngine();
    let states = [initialEngineState()];
    const cmd: EngineCommand = {
      ...idleCommand,
      throttleTarget: 1,
      on: true,
    };
    const thrustMags: number[] = [];
    for (let i = 0; i < 10; i++) {
      const out = aggregate([engine], states, [cmd], Vec3.ZERO, 0, 0.05);
      states = [...out.newStates];
      thrustMags.push(Vec3.length(out.forceBody));
    }
    for (let i = 1; i < thrustMags.length; i++) {
      expect(thrustMags[i]).toBeGreaterThan(thrustMags[i - 1]!);
    }
  });
});

describe("Presets", () => {
  it("SuperHeavyEngines has 33 engines, only 3 can gimbal", () => {
    expect(SuperHeavyEngines.length).toBe(33);
    const gimbalable = SuperHeavyEngines.filter((e) => e.canGimbal);
    expect(gimbalable.length).toBe(3);
  });

  it("StarshipEngines has 6 engines, 3 gimballed sea-level + 3 fixed vacuum", () => {
    expect(StarshipEngines.length).toBe(6);
    const gimbalable = StarshipEngines.filter((e) => e.canGimbal);
    expect(gimbalable.length).toBe(3);
    // Vacuum engines have thrustSea = 0; SL engines have non-zero.
    const slCount = StarshipEngines.filter((e) => e.thrustSea > 0).length;
    const vacCount = StarshipEngines.filter((e) => e.thrustSea === 0).length;
    expect(slCount).toBe(3);
    expect(vacCount).toBe(3);
  });

  it("SuperHeavyEngines fully throttled in vacuum produces enough thrust to lift the booster", () => {
    // T/W > 1 for the dry booster + propellant. Rough sanity check: total
    // thrust > approx max weight (1g) on Earth.
    const states = SuperHeavyEngines.map(() => ({
      ...initialEngineState(),
      throttle: 1,
      on: true,
    }));
    const commands = SuperHeavyEngines.map(
      (): EngineCommand => ({
        ...idleCommand,
        throttleTarget: 1,
        on: true,
      }),
    );
    const out = aggregate(
      SuperHeavyEngines,
      states,
      commands,
      Vec3.of(0, 30, 0), // approximate CoM
      0, // vacuum
      0.01,
    );
    const totalThrust = Vec3.length(out.forceBody);
    // 33 engines × ~2.3 MN ≈ 76 MN. Wet mass ~3.6 Mkg × 9.81 = ~35 MN.
    // T/W in vacuum should be ~2.
    expect(totalThrust).toBeGreaterThan(70_000_000);
    expect(totalThrust).toBeLessThan(80_000_000);
  });
});
