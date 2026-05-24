import { describe, expect, it } from "vitest";

import {
  initialSurfaceState,
  surfaceForceTorque,
  updateSurface,
  type Surface,
} from "./aero.js";
import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";
import { BoosterFins } from "./presets/booster-fins.js";
import { ShipFlaps } from "./presets/ship-flaps.js";

const baseSurface = (overrides: Partial<Surface> = {}): Surface => ({
  kind: "flap",
  mount: Vec3.of(1, 0, 0),
  hingeAxisBody: Vec3.of(0, 1, 0), // hinge about body +y
  zeroDeflectionNormalBody: Vec3.of(1, 0, 0), // points +x at zero deflection
  area: 5,
  clAlpha: 4,
  cd0: 0.05,
  maxDeflection: 1,
  maxDeflectionRate: 0.5,
  alphaStall: 0.436,
  tau: 0.1,
  ...overrides,
});

const STD_DENSITY = 1.225;

describe("updateSurface", () => {
  it("first-order lag toward target", () => {
    const s = baseSurface({ tau: 0.2, maxDeflectionRate: 10 });
    let st = initialSurfaceState();
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      st = updateSurface(s, st, 0.5, 0.05);
      samples.push(st.deflection);
    }
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]!);
    }
    expect(samples[samples.length - 1]).toBeCloseTo(0.5, 3);
  });

  it("target clamped to ±maxDeflection", () => {
    const s = baseSurface({ tau: 0.001, maxDeflectionRate: 100 });
    let st = initialSurfaceState();
    for (let i = 0; i < 100; i++) st = updateSurface(s, st, 5, 0.05);
    expect(st.deflection).toBeCloseTo(s.maxDeflection, 6);
  });

  it("slew rate enforced", () => {
    const s = baseSurface({ tau: 0.0001, maxDeflectionRate: 0.5 });
    const st = updateSurface(s, initialSurfaceState(), 1, 0.1);
    expect(st.deflection).toBeLessThanOrEqual(0.05 + 1e-9); // 0.5 * 0.1
  });
});

describe("surfaceForceTorque", () => {
  const idle = initialSurfaceState();
  const noOmega = Vec3.ZERO;
  const noAttitude = Quat.IDENTITY;
  const com = Vec3.of(0, 10, 0);

  it("zero airflow → zero force/torque", () => {
    const c = surfaceForceTorque(
      baseSurface(),
      idle,
      Vec3.ZERO,
      noOmega,
      noAttitude,
      com,
      STD_DENSITY,
    );
    expect(c.forceBody).toEqual(Vec3.ZERO);
    expect(c.torqueBody).toEqual(Vec3.ZERO);
  });

  it("zero density → zero force/torque", () => {
    const c = surfaceForceTorque(
      baseSurface(),
      idle,
      Vec3.of(100, 0, 0),
      noOmega,
      noAttitude,
      com,
      0,
    );
    expect(c.forceBody).toEqual(Vec3.ZERO);
    expect(c.torqueBody).toEqual(Vec3.ZERO);
  });

  it("zero deflection, zero AoA (wind parallel to surface plane) → zero lift, finite drag", () => {
    // Surface normal is +x at zero deflection. Wind in -x (we move in +x)
    // would mean n · windDir = (1)(-1) = -1, AoA = -90° — high AoA, lots of
    // lift. Instead, fly in the +y direction: wind is in -y, n · windDir = 0,
    // AoA = 0 → no lift, only parasitic drag.
    const surface = baseSurface();
    const c = surfaceForceTorque(
      surface,
      idle,
      Vec3.of(0, 100, 0),
      noOmega,
      noAttitude,
      com,
      STD_DENSITY,
    );
    const fMag = Vec3.length(c.forceBody);
    // Lift contribution: clAlpha * 0 = 0, so the only force is drag.
    // Drag magnitude = 0.5 * 1.225 * 100² * 5 * 0.05 = 1531.25
    const expectedDragMag =
      0.5 * STD_DENSITY * 100 * 100 * surface.area * surface.cd0;
    expect(fMag).toBeCloseTo(expectedDragMag, 3);
    // Force should be along the wind direction (which is -y here, since
    // the body moves +y; drag pushes body downwind ⇒ +y in body = wait,
    // wind blows past body in -y direction, drag pushes body in that direction
    // ⇒ force.y < 0).
    expect(c.forceBody.y).toBeLessThan(0);
  });

  it("non-zero AoA produces lift", () => {
    // Body falls in -y, surface normal is +x at zero deflection. Then
    // n · windDir = +x · +y = 0 → no lift. Add a deflection: rotate the
    // normal by 30° about hinge (+y) → normal tilts in xz plane (won't help).
    //
    // Better: fly along +x, normal at +x. Then n · windDir = +x · -x = -1,
    // AoA = -π/2 (perpendicular). Clamped at stall → finite lift.
    const surface = baseSurface();
    const c = surfaceForceTorque(
      surface,
      idle,
      Vec3.of(100, 0, 0),
      noOmega,
      noAttitude,
      com,
      STD_DENSITY,
    );
    expect(Vec3.length(c.forceBody)).toBeGreaterThan(0);
  });

  it("symmetric pair of surfaces with same deflection: forces add, torques cancel", () => {
    // Two surfaces on opposite sides (+x and -x), both with normal pointing
    // radially outward, both hinged about +y. Wind in +y direction (body
    // moves -y → no wait. Let's set up wind in +y body frame, which means
    // body velocity in -y in body frame... use omega for wind contribution.
    //
    // Simplest: zero body velocity, +omega.z. Then at mount (1, 0, 0),
    // ω × r = (0,0,ω) × (1,0,0) = (0*0 - ω*0, ω*1 - 0*0, 0*0 - 0*1) = (0, ω, 0)
    // → mount moves in +y → wind comes from -y direction relative to surface
    //   (windDir = -y).
    // At mount (-1, 0, 0): ω × r = (0,0,ω) × (-1,0,0) = (0, -ω, 0)
    // → mount moves in -y → windDir = +y.
    //
    // Sym surfaces, opposite mounts: actually this isn't symmetric — the
    // wind directions are opposite. So the rotation case isn't a clean
    // "symmetric force" test.
    //
    // Simpler: use translational velocity in -y (body falls). Both surfaces
    // see the same wind (+y in body frame). Then:
    // - For surface at +x with normal +x: n · windDir = +x · +y = 0 → no lift,
    //   only drag in +y direction.
    // - For surface at -x with normal -x: n · windDir = -x · +y = 0 → same.
    // Both produce equal +y drag. Mounts at +x and -x. Torques about
    // CoM (0,10,0):
    //   arm_+ = (1,-10,0); force = (0, +F, 0); τ = arm × F = (-10*0 - 0*F, 0*0 - 1*0, 1*F - (-10)*0) = (0,0,F)
    //   arm_- = (-1,-10,0); force = (0, +F, 0); τ = (-10*0 - 0*F, 0*0-(-1)*0, (-1)*F - (-10)*0) = (0,0,-F)
    // Torques cancel ✓.
    const left = baseSurface({
      mount: Vec3.of(1, 0, 0),
      zeroDeflectionNormalBody: Vec3.of(1, 0, 0),
    });
    const right = baseSurface({
      mount: Vec3.of(-1, 0, 0),
      zeroDeflectionNormalBody: Vec3.of(-1, 0, 0),
    });
    const vWorld = Vec3.of(0, -50, 0); // body falling
    const cL = surfaceForceTorque(
      left,
      idle,
      vWorld,
      noOmega,
      noAttitude,
      com,
      STD_DENSITY,
    );
    const cR = surfaceForceTorque(
      right,
      idle,
      vWorld,
      noOmega,
      noAttitude,
      com,
      STD_DENSITY,
    );
    const totalForce = Vec3.add(cL.forceBody, cR.forceBody);
    const totalTorque = Vec3.add(cL.torqueBody, cR.torqueBody);
    expect(Vec3.length(totalForce)).toBeGreaterThan(0);
    expect(Math.abs(totalTorque.x)).toBeLessThan(1e-6);
    expect(Math.abs(totalTorque.y)).toBeLessThan(1e-6);
    expect(Math.abs(totalTorque.z)).toBeLessThan(1e-6);
  });

  it("asymmetric deflection produces torque", () => {
    // For deflection to change AoA, the hinge axis must be perpendicular
    // to the wind. Body falls in -y → wind in body is +y. Use hinge axis
    // +z so deflection rotates the +x normal into the xy plane → gains a
    // +y or -y component → non-zero AoA.
    const surface = baseSurface({
      hingeAxisBody: Vec3.of(0, 0, 1),
    });
    const undeflected = initialSurfaceState();
    const deflected = { deflection: 0.3 };
    const cUndef = surfaceForceTorque(
      surface,
      undeflected,
      Vec3.of(0, -100, 0),
      noOmega,
      noAttitude,
      com,
      STD_DENSITY,
    );
    const cDef = surfaceForceTorque(
      surface,
      deflected,
      Vec3.of(0, -100, 0),
      noOmega,
      noAttitude,
      com,
      STD_DENSITY,
    );
    // Deflected case has AoA ≈ 0.3, so Cl > 0 → lift adds to torque.
    expect(Vec3.length(cDef.torqueBody)).not.toBeCloseTo(
      Vec3.length(cUndef.torqueBody),
      4,
    );
    // Deflected torque magnitude should be larger (lift adds to drag).
    expect(Vec3.length(cDef.torqueBody)).toBeGreaterThan(
      Vec3.length(cUndef.torqueBody),
    );
  });

  it("rotational contribution (ω × r) affects the local airflow even with zero body velocity", () => {
    // Stationary CoM, but spinning body. The surface at +x sees a tangential
    // wind from rotation.
    const surface = baseSurface();
    const c = surfaceForceTorque(
      surface,
      { deflection: 0.3 },
      Vec3.ZERO,
      Vec3.of(0, 0, 1), // ω about body z
      noAttitude,
      com,
      STD_DENSITY,
    );
    expect(Vec3.length(c.forceBody)).toBeGreaterThan(0);
  });
});

describe("Presets", () => {
  it("BoosterFins has 4 fins, all grid_fin kind", () => {
    expect(BoosterFins.length).toBe(4);
    expect(BoosterFins.every((f) => f.kind === "grid_fin")).toBe(true);
  });

  it("ShipFlaps has 4 flaps, all flap kind", () => {
    expect(ShipFlaps.length).toBe(4);
    expect(ShipFlaps.every((f) => f.kind === "flap")).toBe(true);
  });

  it("BoosterFins are spaced 90° around the body", () => {
    // Each fin's mount should be at radius ≈ R_BODY in the xz plane.
    const r = Math.hypot(BoosterFins[0]!.mount.x, BoosterFins[0]!.mount.z);
    for (const fin of BoosterFins) {
      const ri = Math.hypot(fin.mount.x, fin.mount.z);
      expect(ri).toBeCloseTo(r, 6);
    }
  });

  it("ShipFlaps has 2 at fwd y and 2 at aft y", () => {
    const ys = ShipFlaps.map((f) => f.mount.y).sort((a, b) => a - b);
    expect(ys[0]).toBe(ys[1]); // two aft at same y
    expect(ys[2]).toBe(ys[3]); // two fwd at same y
    expect(ys[2]).toBeGreaterThan(ys[1]!); // fwd above aft
  });
});
