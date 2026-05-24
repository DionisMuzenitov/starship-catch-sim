import { describe, expect, it } from "vitest";

import { step } from "./integrator.js";
import { Mat3 } from "./math/mat3.js";
import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";
import { createRigidBody, type RigidBodyState } from "./state.js";

const GRAVITY = 9.81;

// A simple unit-mass, unit-diagonal-inertia body. Useful for translation
// and principal-axis spin tests.
const unitBody = (overrides: Partial<RigidBodyState> = {}): RigidBodyState =>
  createRigidBody({
    mass: 1,
    inertia: Mat3.fromDiagonal(Vec3.of(1, 1, 1)),
    ...overrides,
  });

// An asymmetric body for nutation tests.
const asymBody = (
  overrides: Partial<RigidBodyState> = {},
): RigidBodyState =>
  createRigidBody({
    mass: 1,
    inertia: Mat3.fromDiagonal(Vec3.of(1, 2, 3)),
    ...overrides,
  });

describe("RK4 integrator — translation", () => {
  it("pure horizontal velocity drifts linearly, attitude unchanged", () => {
    const dt = 0.01;
    const N = 1000;
    let s = unitBody({ velocity: Vec3.of(3, 0, 0) });
    for (let i = 0; i < N; i++) {
      s = step(s, Vec3.ZERO, Vec3.ZERO, dt);
    }
    // After 10s at 3 m/s: position = 30 m on X
    expect(Math.abs(s.position.x - 30)).toBeLessThan(1e-9);
    expect(Math.abs(s.position.y)).toBeLessThan(1e-12);
    expect(Math.abs(s.position.z)).toBeLessThan(1e-12);
    expect(Quat.equalsRotation(s.attitude, Quat.IDENTITY, 1e-12)).toBe(true);
    expect(Vec3.equals(s.angularVelocity, Vec3.ZERO, 1e-12)).toBe(true);
  });

  it("ballistic free fall conserves energy (1000 steps @ dt=10ms)", () => {
    const dt = 0.01;
    const N = 1000;
    const m = 1000; // kg
    const initialH = 1000; // m
    const initialVx = 50; // m/s
    let s = unitBody({
      mass: m,
      inertia: Mat3.fromDiagonal(Vec3.of(100, 100, 100)),
      position: Vec3.of(0, initialH, 0),
      velocity: Vec3.of(initialVx, 0, 0),
    });
    const gravityForce = Vec3.of(0, -m * GRAVITY, 0);
    const energy = (state: RigidBodyState) =>
      0.5 * state.mass * Vec3.lengthSquared(state.velocity) +
      state.mass * GRAVITY * state.position.y;

    const E0 = energy(s);
    for (let i = 0; i < N; i++) {
      s = step(s, gravityForce, Vec3.ZERO, dt);
    }
    const Ef = energy(s);
    const relativeError = Math.abs(Ef - E0) / Math.abs(E0);
    // RK4 with constant force should preserve energy to many digits over 10s.
    expect(relativeError).toBeLessThan(1e-9);
  });

  it("F = m a: constant force produces correct kinematics over one step", () => {
    const m = 2;
    const F = Vec3.of(10, 0, 0); // 10 N
    const dt = 0.1;
    const s0 = unitBody({ mass: m });
    const s1 = step(s0, F, Vec3.ZERO, dt);
    // a = F/m = 5 m/s²
    // v(dt) = a*dt = 0.5 m/s
    // x(dt) = 0.5*a*dt² = 0.025 m
    expect(Math.abs(s1.velocity.x - 0.5)).toBeLessThan(1e-12);
    expect(Math.abs(s1.position.x - 0.025)).toBeLessThan(1e-12);
  });
});

describe("RK4 integrator — rotation", () => {
  it("pure spin about a principal axis: ω stays constant, attitude rotates linearly", () => {
    const dt = 0.01;
    const N = 1000;
    const spinRate = 1.0; // rad/s about body X (a principal axis since inertia is diagonal)
    let s = unitBody({ angularVelocity: Vec3.of(spinRate, 0, 0) });
    for (let i = 0; i < N; i++) {
      s = step(s, Vec3.ZERO, Vec3.ZERO, dt);
    }
    // ω stays constant for principal-axis spin (ω × Iω = 0 when I is diagonal
    // and ω is aligned with a principal axis).
    expect(Vec3.equals(s.angularVelocity, Vec3.of(spinRate, 0, 0), 1e-9)).toBe(
      true,
    );
    // After 10s @ 1 rad/s about X: total rotation 10 rad
    // attitude should be fromAxisAngle(X, 10 rad)
    const expected = Quat.fromAxisAngle(Vec3.of(1, 0, 0), spinRate * N * dt);
    expect(Quat.equalsRotation(s.attitude, expected, 1e-6)).toBe(true);
  });

  it("attitude quaternion stays unit-norm after many steps", () => {
    const dt = 0.01;
    const N = 1000;
    let s = unitBody({ angularVelocity: Vec3.of(0.7, 0.3, 0.5) });
    for (let i = 0; i < N; i++) {
      s = step(s, Vec3.ZERO, Vec3.ZERO, dt);
    }
    expect(Math.abs(Quat.length(s.attitude) - 1)).toBeLessThan(1e-12);
  });

  it("torque-free spin on asymmetric body: kinetic energy and angular momentum magnitude conserved", () => {
    // Spinning about a non-principal axis on an asymmetric body causes
    // nutation (Euler's intermediate-axis instability for some configs).
    // Pure regression check: the dynamics are non-trivial, so we verify
    // the two conservation laws — rotational KE and ||L|| — which should
    // hold exactly in continuous time and very nearly under RK4.
    const dt = 0.005;
    const N = 2000;
    let s = asymBody({ angularVelocity: Vec3.of(0.5, 1.0, 0.2) });
    const energy = (state: RigidBodyState) => {
      const Iw = Mat3.multiplyVec3(state.inertia, state.angularVelocity);
      return 0.5 * Vec3.dot(state.angularVelocity, Iw);
    };
    const angMomMag = (state: RigidBodyState) => {
      const Iw = Mat3.multiplyVec3(state.inertia, state.angularVelocity);
      // L in world frame: q * Iω_body * q⁻¹, but its magnitude equals |Iω|.
      return Vec3.length(Iw);
    };
    const E0 = energy(s);
    const L0 = angMomMag(s);
    let omegaChanged = false;
    const omega0 = s.angularVelocity;
    for (let i = 0; i < N; i++) {
      s = step(s, Vec3.ZERO, Vec3.ZERO, dt);
      if (!Vec3.equals(s.angularVelocity, omega0, 1e-6)) omegaChanged = true;
    }
    // Sanity: ω actually moved (nutation visible).
    expect(omegaChanged).toBe(true);
    // Conservation laws hold to RK4 precision.
    expect(Math.abs(energy(s) - E0) / E0).toBeLessThan(1e-8);
    expect(Math.abs(angMomMag(s) - L0) / L0).toBeLessThan(1e-8);
  });

  it("applied torque about principal axis spins up linearly", () => {
    const dt = 0.01;
    const N = 100;
    // I = diag(2, 2, 2), τ = (1, 0, 0) → α = 0.5 rad/s² about X
    let s = unitBody({ inertia: Mat3.fromDiagonal(Vec3.of(2, 2, 2)) });
    for (let i = 0; i < N; i++) {
      s = step(s, Vec3.ZERO, Vec3.of(1, 0, 0), dt);
    }
    // After 1s, ω.x = α*t = 0.5 rad/s
    expect(Math.abs(s.angularVelocity.x - 0.5)).toBeLessThan(1e-9);
    expect(Math.abs(s.angularVelocity.y)).toBeLessThan(1e-12);
    expect(Math.abs(s.angularVelocity.z)).toBeLessThan(1e-12);
  });
});

describe("RK4 integrator — performance", () => {
  // Local dev hardware (M-series Mac) measures ~15 ms for this loop.
  // GitHub Actions `ubuntu-latest` runners are ~3–4x slower for CPU-bound
  // JS, so we use 200 ms as the bound — still catches a ~13x regression
  // from the local baseline while not flaking on CI. Tracked in SLS-38.
  const PERF_BUDGET_MS = 200;

  it(`10 000 steps in under ${PERF_BUDGET_MS} ms`, () => {
    const dt = 0.01;
    let s = asymBody({
      position: Vec3.of(0, 100, 0),
      velocity: Vec3.of(5, 0, 0),
      angularVelocity: Vec3.of(0.5, 1.0, 0.2),
    });
    const gravityForce = Vec3.of(0, -GRAVITY, 0);
    const torque = Vec3.of(0.1, 0, 0);

    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      s = step(s, gravityForce, torque, dt);
    }
    const elapsed = performance.now() - start;
    // Log so the bound is visible in test output (SLS-8 AC).
    console.log(`[perf] 10,000 RK4 steps in ${elapsed.toFixed(2)} ms`);
    expect(elapsed).toBeLessThan(PERF_BUDGET_MS);
    // Silence unused-state warning while still validating it stays finite.
    expect(Number.isFinite(s.position.y)).toBe(true);
  });
});
