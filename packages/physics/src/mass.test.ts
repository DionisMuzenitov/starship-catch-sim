import { describe, expect, it } from "vitest";

import {
  consumeFuel,
  currentCoM,
  currentInertia,
  currentMass,
  full,
  tankCapacity,
  type MassProperties,
} from "./mass.js";
import { Mat3 } from "./math/mat3.js";
import { Vec3 } from "./math/vec3.js";
import { StarshipMass } from "./presets/starship.js";
import { SuperHeavyMass } from "./presets/super-heavy.js";

const PI = Math.PI;

// Test fixture: small synthetic body where hand-computed expectations are
// trivial. Cylinder of radius 1 m, height 10 m, sitting on the y axis from
// y=0 to y=10. Dry mass 1000 kg, dry CoM at (0, 5, 0). Dry inertia chosen
// arbitrarily but symmetric and positive.
const dryInertia = Mat3.of(800, 0, 0, 0, 200, 0, 0, 0, 800);
const fixture: MassProperties = {
  dryMass: 1000,
  propellantMass: 0,
  dryCoM: Vec3.of(0, 5, 0),
  dryInertia,
  tankBottom: 0,
  tankTop: 10,
  tankRadius: 1,
  propellantDensity: 100, // chosen so full capacity = PI * 1² * 10 * 100 = 1000π
};

const sylvesterPositiveDefinite = (m: Mat3): boolean => {
  const minor1 = m[0];
  const minor2 = m[0] * m[4] - m[1] * m[3];
  const minor3 = Mat3.determinant(m);
  return minor1 > 0 && minor2 > 0 && minor3 > 0;
};

describe("MassProperties — basic helpers", () => {
  it("currentMass = dry + propellant", () => {
    expect(currentMass({ ...fixture, propellantMass: 300 })).toBe(1300);
  });

  it("tankCapacity = cylinder volume × density", () => {
    expect(tankCapacity(fixture)).toBeCloseTo(PI * 1 * 1 * 10 * 100, 9);
  });

  it("full fills propellant to tank capacity", () => {
    const filled = full(fixture);
    expect(filled.propellantMass).toBeCloseTo(tankCapacity(fixture), 9);
  });

  it("consumeFuel reduces propellant", () => {
    const mp = full(fixture);
    const after = consumeFuel(mp, 100);
    expect(after.propellantMass).toBeCloseTo(mp.propellantMass - 100, 9);
  });

  it("consumeFuel clamps at zero", () => {
    const after = consumeFuel(fixture, 1e9);
    expect(after.propellantMass).toBe(0);
  });
});

describe("MassProperties — CoM and inertia geometry", () => {
  it("empty: combined CoM equals dry CoM", () => {
    expect(currentCoM(fixture)).toEqual(fixture.dryCoM);
  });

  it("empty: combined inertia equals dry inertia (no parallel-axis shift)", () => {
    expect(Mat3.equals(currentInertia(fixture), dryInertia, 1e-9)).toBe(true);
  });

  it("full: combined CoM is between dry CoM and propellant CoM", () => {
    const filled = full(fixture);
    const com = currentCoM(filled);
    // Propellant column height = capacity / (π r² ρ) = tankTop - tankBottom = 10
    // → propellant CoM y = 5 (midpoint). Dry CoM y = 5. Both equal here.
    expect(com.y).toBeCloseTo(5, 9);
  });

  it("CoM converges to dry CoM as fuel approaches zero", () => {
    // Note: the trajectory of the combined CoM as fuel burns is NOT
    // necessarily monotonic in distance from dry CoM — it can move away
    // first and then approach, because both the propellant *mass* and the
    // propellant *CoM* are changing. The real invariant is the limit: when
    // propellantMass → 0, combined CoM → dry CoM.
    const offset: MassProperties = {
      ...fixture,
      dryCoM: Vec3.of(0, 8, 0),
    };
    let mp = full(offset);
    const initialDistance = Math.abs(currentCoM(mp).y - offset.dryCoM.y);

    // Burn down to almost-empty in fine steps and check the limit.
    const N = 100;
    const burnPerStep = mp.propellantMass / N;
    for (let i = 0; i < N; i++) {
      mp = consumeFuel(mp, burnPerStep);
    }
    expect(mp.propellantMass).toBeCloseTo(0, 9);
    expect(currentCoM(mp).y).toBeCloseTo(offset.dryCoM.y, 9);

    // Sanity: the CoM actually moved at some point (i.e. propellant matters).
    expect(initialDistance).toBeGreaterThan(0);
  });

  it("mass monotonically decreases under repeated consumeFuel", () => {
    let mp = full(fixture);
    let prev = currentMass(mp);
    for (let i = 0; i < 10; i++) {
      mp = consumeFuel(mp, 50);
      const next = currentMass(mp);
      expect(next).toBeLessThanOrEqual(prev);
      prev = next;
    }
  });

  it("inertia remains positive-definite at every fuel level", () => {
    let mp = full(fixture);
    const burn = mp.propellantMass / 20;
    for (let i = 0; i < 25; i++) {
      expect(sylvesterPositiveDefinite(currentInertia(mp))).toBe(true);
      mp = consumeFuel(mp, burn);
    }
    // After all burns, propellant is zero.
    expect(mp.propellantMass).toBe(0);
  });

  it("snapshot: full tank propellant inertia matches hand-computed cylinder formula", () => {
    // Configure so propellant CoM coincides exactly with combined CoM —
    // then the parallel-axis term vanishes and the propellant contribution
    // is just the cylinder formula.
    const mp = full({
      ...fixture,
      // Use a small dry mass so propellant dominates; then put dry CoM at the
      // propellant CoM so all parallel-axis displacements are zero.
      dryMass: 1, // tiny, but non-zero
      dryCoM: Vec3.of(0, 5, 0), // = propellant CoM when tank is full
      dryInertia: Mat3.of(0, 0, 0, 0, 0, 0, 0, 0, 0), // zero so we isolate the propellant term
    });
    const m = mp.propellantMass; // tank capacity
    const r = 1;
    const h = 10;
    const expectedYY = 0.5 * m * r * r;
    const expectedXX = (1 / 12) * m * (3 * r * r + h * h);
    const I = currentInertia(mp);
    expect(I[0]).toBeCloseTo(expectedXX, 6);
    expect(I[4]).toBeCloseTo(expectedYY, 6);
    expect(I[8]).toBeCloseTo(expectedXX, 6);
    // off-diagonals essentially zero
    expect(Math.abs(I[1]!)).toBeLessThan(1e-6);
    expect(Math.abs(I[5]!)).toBeLessThan(1e-6);
  });
});

describe("Presets", () => {
  const expectPlausible = (mp: MassProperties, label: string) => {
    const fueled = full(mp);
    const m0 = currentMass(fueled);
    const I = currentInertia(fueled);
    expect(m0, `${label}: total mass > dry mass`).toBeGreaterThan(mp.dryMass);
    expect(
      sylvesterPositiveDefinite(I),
      `${label}: fueled inertia must be positive-definite`,
    ).toBe(true);
    expect(
      sylvesterPositiveDefinite(currentInertia(mp)),
      `${label}: empty inertia must be positive-definite`,
    ).toBe(true);
  };

  it("SuperHeavyMass: in the right order of magnitude (dry ~2e5 kg, full > 3e6 kg)", () => {
    const fueled = full(SuperHeavyMass);
    expect(currentMass(fueled)).toBeGreaterThan(3_000_000);
    expect(currentMass(fueled)).toBeLessThan(4_000_000);
    expectPlausible(SuperHeavyMass, "SuperHeavyMass");
  });

  it("StarshipMass: in the right order of magnitude (dry ~1.2e5 kg, full > 1e6 kg)", () => {
    const fueled = full(StarshipMass);
    expect(currentMass(fueled)).toBeGreaterThan(1_000_000);
    expect(currentMass(fueled)).toBeLessThan(2_000_000);
    expectPlausible(StarshipMass, "StarshipMass");
  });
});
