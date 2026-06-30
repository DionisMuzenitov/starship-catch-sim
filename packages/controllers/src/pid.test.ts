import { describe, expect, it } from "vitest";

import { PID } from "./pid.js";

const baseGains = {
  kp: 1,
  ki: 0,
  kd: 0,
  outputClamp: [-Infinity, Infinity] as const,
  integralClamp: [-Infinity, Infinity] as const,
  derivativeFilterTau: 0,
  kAw: 1,
};

describe("PID basic behaviour", () => {
  it("P-only output equals kp * error", () => {
    const pid = new PID({ ...baseGains, kp: 2 });
    expect(pid.update(10, 0, 0.01)).toBeCloseTo(20, 9);
    expect(pid.update(0, 5, 0.01)).toBeCloseTo(-10, 9);
  });

  it("I-only accumulates error * dt over multiple ticks", () => {
    const pid = new PID({ ...baseGains, kp: 0, ki: 1 });
    pid.update(1, 0, 0.1);
    pid.update(1, 0, 0.1);
    const out = pid.update(1, 0, 0.1);
    expect(out).toBeCloseTo(0.3, 9);
    expect(pid.getIntegral()).toBeCloseTo(0.3, 9);
  });

  it("reset() clears integrator and derivative history", () => {
    const pid = new PID({ ...baseGains, kp: 0, ki: 1 });
    pid.update(1, 0, 0.5);
    expect(pid.getIntegral()).toBeCloseTo(0.5, 9);
    pid.reset();
    expect(pid.getIntegral()).toBe(0);
    // After reset, first derivative tick has no prior measurement → 0.
    const pidD = new PID({ ...baseGains, kp: 0, kd: 1 });
    pidD.update(0, 0, 0.1);
    pidD.update(0, 1, 0.1);
    expect(pidD.getDerivative()).toBeCloseTo(10, 9);
    pidD.reset();
    pidD.update(0, 0, 0.1);
    expect(pidD.getDerivative()).toBe(0);
  });

  it("dt <= 0 returns clamped P term without polluting state", () => {
    const pid = new PID({ ...baseGains, kp: 2, ki: 5 });
    const out = pid.update(10, 0, 0);
    expect(out).toBeCloseTo(20, 9);
    expect(pid.getIntegral()).toBe(0);
  });
});

describe("PID derivative on measurement", () => {
  it("a step in setpoint with constant measurement produces no derivative kick", () => {
    const pid = new PID({ ...baseGains, kp: 0, kd: 1 });
    pid.update(0, 0, 0.1);
    const out = pid.update(100, 0, 0.1);
    // d/dt(measurement) = 0 even though setpoint changed → derivative term = 0,
    // so output is the (unused) P + I terms, both zero here.
    expect(out).toBe(0);
  });

  it("derivative tracks the rate of change of the measurement", () => {
    const pid = new PID({ ...baseGains, kp: 0, kd: 1 });
    pid.update(0, 0, 0.1);
    // measurement rises by 1 per tick of 0.1 s → rawDerivative = 10
    // kd term is subtracted (derivative-on-measurement), so output = -10.
    const out = pid.update(0, 1, 0.1);
    expect(out).toBeCloseTo(-10, 9);
  });

  it("LP filter on the derivative smooths the response", () => {
    const fast = new PID({ ...baseGains, kp: 0, kd: 1 });
    const slow = new PID({ ...baseGains, kp: 0, kd: 1, derivativeFilterTau: 0.5 });
    fast.update(0, 0, 0.01);
    slow.update(0, 0, 0.01);
    const stepFast = Math.abs(fast.update(0, 1, 0.01));
    const stepSlow = Math.abs(slow.update(0, 1, 0.01));
    expect(stepFast).toBeGreaterThan(stepSlow);
  });
});

describe("PID anti-windup", () => {
  it("output saturation clamps and unwinds the integrator", () => {
    const pid = new PID({
      ...baseGains,
      kp: 1,
      ki: 10,
      outputClamp: [-1, 1],
      kAw: 10, // textbook AW gain: ki / kp.
    });
    // Drive a huge error for many steps so the integrator wants to blow
    // past the clamp. With anti-windup, the integrator stays bounded at
    // a fixed point well below the unbounded value.
    for (let i = 0; i < 100; i++) {
      pid.update(10, 0, 0.1);
    }
    // Without AW the integrator would be 10 * 10 * 0.1 * 100 = 1000.
    // With back-calculation it stabilises near a small bounded value
    // (steady state ≈ |9| for this configuration — order-of-magnitude
    // smaller than the runaway).
    expect(Math.abs(pid.getIntegral())).toBeLessThan(15);
    expect(pid.update(10, 0, 0.1)).toBeCloseTo(1, 6);
  });

  it("integral clamp limits accumulator independent of output clamp", () => {
    const pid = new PID({
      ...baseGains,
      kp: 0,
      ki: 1,
      integralClamp: [-2, 2],
    });
    for (let i = 0; i < 1000; i++) pid.update(100, 0, 0.1);
    expect(pid.getIntegral()).toBeCloseTo(2, 6);
  });

  it("ki=0 skips anti-windup branch but still clamps output", () => {
    const pid = new PID({
      ...baseGains,
      kp: 10,
      ki: 0,
      outputClamp: [-5, 5],
    });
    expect(pid.update(10, 0, 0.1)).toBe(5);
    expect(pid.update(-10, 0, 0.1)).toBe(-5);
    expect(pid.getIntegral()).toBe(0);
  });
});
