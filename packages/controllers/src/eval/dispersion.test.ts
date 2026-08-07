import {
  BoosterDescentCalm,
  BoosterDescentStandard,
  BoosterDescentStormy,
  Vec3,
  currentMass,
} from "@starship-catch-sim/physics";
import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_SEED_BASE,
  DISPERSION,
  acceptanceSeeds,
  dispersedEnv,
  dispersedInitialWorld,
} from "./dispersion";

const sc = BoosterDescentStandard;

function stddev(xs: number[]): number {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

describe("dispersedInitialWorld (SLS-110)", () => {
  it("is deterministic in the seed", () => {
    const a = dispersedInitialWorld(sc, 7);
    const b = dispersedInitialWorld(sc, 7);
    expect(a).toEqual(b);
  });

  it("differs across seeds in position, velocity, attitude and rates", () => {
    const a = dispersedInitialWorld(sc, 1);
    const b = dispersedInitialWorld(sc, 2);
    expect(a.rigidBody.position).not.toEqual(b.rigidBody.position);
    expect(a.rigidBody.velocity).not.toEqual(b.rigidBody.velocity);
    expect(a.rigidBody.attitude).not.toEqual(b.rigidBody.attitude);
    expect(a.rigidBody.angularVelocity).not.toEqual(b.rigidBody.angularVelocity);
  });

  it("samples the grounded position spread (σ within 2× of target over 400 seeds)", () => {
    const xs: number[] = [];
    const ys: number[] = [];
    const p0 = sc.initialWorld.rigidBody.position;
    for (let s = 0; s < 400; s++) {
      const w = dispersedInitialWorld(sc, s);
      xs.push(w.rigidBody.position.x - p0.x);
      ys.push(w.rigidBody.position.y - p0.y);
    }
    // Wide sanity band: the empirical σ should be near the target, and — the
    // point of the ticket — MUCH larger than the old ±20 m.
    expect(stddev(xs)).toBeGreaterThan(DISPERSION.posHorizM * 0.5);
    expect(stddev(xs)).toBeLessThan(DISPERSION.posHorizM * 1.6);
    expect(stddev(ys)).toBeGreaterThan(DISPERSION.posVertM * 0.5);
    expect(stddev(xs)).toBeGreaterThan(100); // >> the old ±20 m jitter
  });

  it("the scale knob narrows the spread proportionally (sweep lever)", () => {
    const p0 = sc.initialWorld.rigidBody.position;
    const wide: number[] = [];
    const narrow: number[] = [];
    for (let s = 0; s < 200; s++) {
      wide.push(dispersedInitialWorld(sc, s, 1).rigidBody.position.x - p0.x);
      narrow.push(dispersedInitialWorld(sc, s, 0.1).rigidBody.position.x - p0.x);
    }
    // scale 0.1 → ~10× tighter spread.
    expect(stddev(narrow)).toBeLessThan(stddev(wide) * 0.25);
    // scale 0 → exactly the nominal (no dispersion).
    const nominal = dispersedInitialWorld(sc, 5, 0);
    expect(nominal.rigidBody.position).toEqual(p0);
  });

  it("keeps residual propellant ≥ 0 and the derived rigid-body mass consistent", () => {
    for (const s of [0, 3, 17, 99]) {
      const w = dispersedInitialWorld(sc, s);
      expect(w.mass.propellantMass).toBeGreaterThanOrEqual(0);
      expect(w.rigidBody.mass).toBeCloseTo(currentMass(w.mass), 6);
    }
  });
});

describe("held-out acceptance seeds (SLS-97 / ADR-024)", () => {
  it("draws from the reserved high band, contiguously", () => {
    const s = acceptanceSeeds(5);
    expect(s).toEqual([
      ACCEPTANCE_SEED_BASE,
      ACCEPTANCE_SEED_BASE + 1,
      ACCEPTANCE_SEED_BASE + 2,
      ACCEPTANCE_SEED_BASE + 3,
      ACCEPTANCE_SEED_BASE + 4,
    ]);
    // The whole band must sit far above any training/dev seed range, and
    // base + N must stay under 2^31 for any realistic N.
    expect(ACCEPTANCE_SEED_BASE).toBeGreaterThan(1_000_000_000);
    expect(ACCEPTANCE_SEED_BASE + 100_000).toBeLessThan(2 ** 31);
  });

  it("held-out realizations are independent of the same-index dev seed", () => {
    // Overfitting-to-test guard: the acceptance draw for index i must NOT
    // equal the dev-range draw for seed i — different specific realizations of
    // the same distribution.
    for (let i = 0; i < 5; i++) {
      const held = dispersedInitialWorld(sc, ACCEPTANCE_SEED_BASE + i);
      const dev = dispersedInitialWorld(sc, i);
      expect(held.rigidBody.position).not.toEqual(dev.rigidBody.position);
    }
  });

  it("stays deterministic and finite at a large acceptance seed (Math.imul guard)", () => {
    // A plain `seed * 0x9e3779b1` loses precision above 2^53 once seeds come
    // from the ~1.5e9 band; Math.imul keeps the Dryden seed a clean 32-bit hash.
    const P = Vec3.of(0, 30_000, 0);
    const s = ACCEPTANCE_SEED_BASE + 7;
    const a = dispersedEnv(BoosterDescentStormy, s).wind.at(P, 2.5);
    const b = dispersedEnv(BoosterDescentStormy, s).wind.at(P, 2.5);
    expect(a).toEqual(b);
    expect(Number.isFinite(a.x) && Number.isFinite(a.z)).toBe(true);
  });
});

describe("dispersedEnv (SLS-110)", () => {
  const P = Vec3.of(0, 30_000, 0);

  it("gives each seed a different stormy gust realization", () => {
    const e1 = dispersedEnv(BoosterDescentStormy, 1);
    const e2 = dispersedEnv(BoosterDescentStormy, 2);
    // Advance both fields the same way; the sampled wind must diverge.
    let diverged = false;
    for (let t = 0; t <= 5; t += 0.5) {
      const w1 = e1.wind.at(P, t);
      const w2 = e2.wind.at(P, t);
      if (Math.abs(w1.x - w2.x) > 1e-6 || Math.abs(w1.z - w2.z) > 1e-6) {
        diverged = true;
        break;
      }
    }
    expect(diverged).toBe(true);
  });

  it("gives Standard per-run variation it never had before", () => {
    const e1 = dispersedEnv(BoosterDescentStandard, 1);
    const e2 = dispersedEnv(BoosterDescentStandard, 2);
    const w1 = e1.wind.at(P, 3);
    const w2 = e2.wind.at(P, 3);
    expect(w1).not.toEqual(w2);
  });

  it("keeps Calm calm (zero wind every seed) — variation comes from the IC", () => {
    for (const s of [0, 5, 42]) {
      const e = dispersedEnv(BoosterDescentCalm, s);
      expect(e.wind.at(P, 2)).toEqual(Vec3.ZERO);
    }
  });

  it("is deterministic in the seed", () => {
    const a = dispersedEnv(BoosterDescentStormy, 11).wind.at(P, 2.5);
    const b = dispersedEnv(BoosterDescentStormy, 11).wind.at(P, 2.5);
    expect(a).toEqual(b);
  });

  it("IC and wind RNG streams are independent — no neighbour collision (review fix)", () => {
    // Regression guard: a one-bit gap between the IC and wind salts previously
    // made run s's IC stream byte-identical to run (s^1)'s wind stream, so
    // icNorm(s) === windNorm(s^1). Sample the first gaussian of each.
    const std = BoosterDescentStandard;
    const p0 = std.initialWorld.rigidBody.position;
    const top = Vec3.of(0, 65_000, 0); // above the top layer → last layer + offset
    const icNorm = (s: number) =>
      (dispersedInitialWorld(std, s).rigidBody.position.x - p0.x) / DISPERSION.posHorizM;
    const windNorm = (s: number) =>
      (dispersedEnv(std, s).wind.at(top, 0).x - 20) / DISPERSION.windMeanMps;
    for (let s = 0; s < 6; s++) {
      expect(Math.abs(icNorm(s) - windNorm(s ^ 1))).toBeGreaterThan(1e-6);
    }
  });
});
