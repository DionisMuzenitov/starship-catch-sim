import { describe, expect, it } from "vitest";

import { neutralControl } from "./control.js";
import { tankCapacity } from "./mass.js";
import { Vec3 } from "./math/vec3.js";
import { simStep } from "./world.js";

import {
  BoosterDescentCalm,
  BoosterDescentStandard,
  BoosterDescentStormy,
  SCENARIOS,
  ShipDescentStandard,
  ShipDescentStormy,
  evaluateCatch,
  scenarioById,
} from "./scenarios.js";
import { chopstickCaptureVolume, DEFAULT_TOWER_STATE } from "./tower.js";

const DT = 0.05;
const BOOSTER_IDS = [
  "booster-descent-calm",
  "booster-descent-standard",
  "booster-descent-stormy",
] as const;
const SHIP_IDS = [
  "ship-descent-calm",
  "ship-descent-standard",
  "ship-descent-stormy",
] as const;

describe("scenarios — exported set", () => {
  it("registers the 3 booster + 3 ship descent variants", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual([...BOOSTER_IDS, ...SHIP_IDS]);
    expect(SCENARIOS.map((s) => s.difficulty)).toEqual([
      "calm",
      "standard",
      "stormy",
      "calm",
      "standard",
      "stormy",
    ]);
  });

  it("scenarioById finds known + returns undefined for unknown", () => {
    expect(scenarioById("booster-descent-stormy")?.id).toBe(
      "booster-descent-stormy",
    );
    expect(scenarioById("ship-descent-stormy")?.id).toBe("ship-descent-stormy");
    expect(scenarioById("no-such-scenario")).toBeUndefined();
  });

  it("booster variants share position, velocity, fuel ~10 % of tank capacity", () => {
    const boosters = SCENARIOS.filter((s) => s.id.startsWith("booster-"));
    expect(boosters).toHaveLength(3);
    for (const s of boosters) {
      const r = s.initialWorld.rigidBody.position;
      expect(r).toEqual(Vec3.of(0, 65_000, 12_260));
      const v = s.initialWorld.rigidBody.velocity;
      expect(v).toEqual(Vec3.of(0, -200, -120));
      const propMass = s.initialWorld.mass.propellantMass;
      const cap = tankCapacity(s.initialWorld.mass);
      expect(propMass / cap).toBeGreaterThan(0.08);
      expect(propMass / cap).toBeLessThan(0.12);
    }
  });

  it("ship variants share position (-100 km, 100 km, 0), velocity (1500, -200, 0), fuel ~6 % of tank capacity", () => {
    const ships = SCENARIOS.filter((s) => s.id.startsWith("ship-"));
    expect(ships).toHaveLength(3);
    for (const s of ships) {
      const r = s.initialWorld.rigidBody.position;
      expect(r).toEqual(Vec3.of(-100_000, 100_000, 0));
      const v = s.initialWorld.rigidBody.velocity;
      expect(v).toEqual(Vec3.of(1500, -200, 0));
      const propMass = s.initialWorld.mass.propellantMass;
      const cap = tankCapacity(s.initialWorld.mass);
      expect(propMass / cap).toBeGreaterThan(0.04);
      expect(propMass / cap).toBeLessThan(0.08);
    }
  });

  it("ship belly-flop attitude: body +Y rotated by initial attitude points along world +X", () => {
    const q = ShipDescentStandard.initialWorld.rigidBody.attitude;
    // Quaternion rotation of (0,1,0).
    const bodyUpWorld = {
      x: 2 * (q.x * q.y - q.w * q.z),
      y: q.w * q.w - q.x * q.x + q.y * q.y - q.z * q.z,
      z: 2 * (q.y * q.z + q.w * q.x),
    };
    expect(bodyUpWorld.x).toBeCloseTo(1, 6);
    expect(bodyUpWorld.y).toBeCloseTo(0, 6);
    expect(bodyUpWorld.z).toBeCloseTo(0, 6);
  });

  it("ship variants start with all flaps deflected to +20° uniformly", () => {
    const ships = SCENARIOS.filter((s) => s.id.startsWith("ship-"));
    const expected = (20 * Math.PI) / 180;
    for (const s of ships) {
      expect(s.initialWorld.surfaceStates).toHaveLength(4);
      for (const st of s.initialWorld.surfaceStates) {
        expect(st.deflection).toBeCloseTo(expected, 6);
      }
    }
  });

  it("ship targetCatch is tighter than booster (|vy|<3, |vh|<1)", () => {
    expect(ShipDescentStandard.targetCatch.verticalSpeedTolMps).toBe(3);
    expect(ShipDescentStandard.targetCatch.horizontalSpeedTolMps).toBe(1);
    expect(BoosterDescentStandard.targetCatch.verticalSpeedTolMps).toBe(5);
    expect(BoosterDescentStandard.targetCatch.horizontalSpeedTolMps).toBe(2);
  });

  it("retrograde attitude: body +Y in world frame is opposite the velocity vector", () => {
    // Body +Y rotated by the initial attitude should point in (0, +0.555, +0.832).
    const s = BoosterDescentStandard;
    const q = s.initialWorld.rigidBody.attitude;
    // Quaternion rotation of (0,1,0).
    const bodyUpWorld = {
      x: 2 * (q.x * q.y - q.w * q.z),
      y: q.w * q.w - q.x * q.x + q.y * q.y - q.z * q.z,
      z: 2 * (q.y * q.z + q.w * q.x),
    };
    expect(bodyUpWorld.x).toBeCloseTo(0, 3);
    expect(bodyUpWorld.y).toBeCloseTo(0.8575, 3);
    expect(bodyUpWorld.z).toBeCloseTo(0.5145, 3);
  });
});

describe("Standard scenario — engines-off smoke", () => {
  it("after 30 s of zero control input, altitude has materially dropped", () => {
    let world = BoosterDescentStandard.initialWorld;
    const ctl = neutralControl(BoosterDescentStandard.vehicle.surfaces.length, 0);
    const y0 = world.rigidBody.position.y;
    for (let i = 0; i < Math.round(30 / DT); i++) {
      world = simStep(
        world,
        BoosterDescentStandard.vehicle,
        ctl,
        DT,
        BoosterDescentStandard.env,
      );
    }
    expect(world.rigidBody.position.y).toBeLessThan(y0 - 3_000);
  });

  it("with enough roll time, free-fall does pass sea level", () => {
    let world = BoosterDescentStandard.initialWorld;
    const ctl = neutralControl(BoosterDescentStandard.vehicle.surfaces.length, 0);
    const N = Math.round(180 / DT);
    let crossed = false;
    for (let i = 0; i < N; i++) {
      world = simStep(
        world,
        BoosterDescentStandard.vehicle,
        ctl,
        DT,
        BoosterDescentStandard.env,
      );
      if (world.rigidBody.position.y <= 0) {
        crossed = true;
        break;
      }
    }
    expect(crossed).toBe(true);
  });
});

describe("Ship Descent — smoke", () => {
  it("after 240 s of zero control input, altitude has dropped at least 5 km", () => {
    let world = ShipDescentStandard.initialWorld;
    const ctl = neutralControl(0, ShipDescentStandard.vehicle.surfaces.length);
    const y0 = world.rigidBody.position.y;
    const N = Math.round(240 / DT);
    for (let i = 0; i < N; i++) {
      world = simStep(
        world,
        ShipDescentStandard.vehicle,
        ctl,
        DT,
        ShipDescentStandard.env,
      );
    }
    expect(world.rigidBody.position.y).toBeLessThan(y0 - 5_000);
  });

  it("fuel-exhaustion verdict fires before the ship reaches the tower", () => {
    // Synthetic far-from-tower world with zero propellant.
    const base = ShipDescentStandard.initialWorld;
    const drained = {
      ...base,
      mass: { ...base.mass, propellantMass: 0 },
      rigidBody: { ...base.rigidBody, mass: base.mass.dryMass },
    };
    const v = ShipDescentStandard.successCriteria(drained);
    expect(v.caught).toBe(false);
    expect(v.reason).toContain("fuel exhausted");
  });
});

describe("Wind plumbing — Calm vs Stormy", () => {
  it("booster stormy wind is deterministic across two fresh runs", () => {
    let a = BoosterDescentStormy.initialWorld;
    let b = BoosterDescentStormy.initialWorld;
    const ctl = neutralControl(BoosterDescentStormy.vehicle.surfaces.length, 0);
    const N = Math.round(5 / DT);
    for (let i = 0; i < N; i++) {
      a = simStep(
        a,
        BoosterDescentStormy.vehicle,
        ctl,
        DT,
        BoosterDescentStormy.env,
      );
      b = simStep(
        b,
        BoosterDescentStormy.vehicle,
        ctl,
        DT,
        BoosterDescentStormy.env,
      );
    }
    expect(a.rigidBody.position).toEqual(b.rigidBody.position);
    expect(a.rigidBody.velocity).toEqual(b.rigidBody.velocity);
  });

  it("ship stormy uses an independent Dryden state from the booster", () => {
    expect(ShipDescentStormy.env.wind).not.toBe(BoosterDescentStormy.env.wind);
  });

  it("scenarioById returns fresh wind state — sequential stormy runs reproduce (SLS-48)", () => {
    // Regression: a shared Dryden singleton froze into a constant gust
    // for any run whose sim time stayed below a previous run's high-water
    // mark. Two SEQUENTIAL full runs from fresh scenarioById() instances
    // must sample identical wind.
    const sample = () => {
      const s = scenarioById("booster-descent-stormy")!;
      const out: number[] = [];
      for (let t = 0; t <= 5; t += 0.5) {
        const w = s.env.wind.at(Vec3.of(0, 1000, 0), t);
        out.push(w.x, w.y, w.z);
      }
      return out;
    };
    const first = sample();
    const second = sample();
    expect(second).toEqual(first);
    // And the gusts really vary over time (not frozen).
    const xs = first.filter((_, i) => i % 3 === 0);
    expect(new Set(xs.map((v) => v.toFixed(6))).size).toBeGreaterThan(1);
  });

  it("catch target sits at the physical chopstick slot centre (SLS-48)", () => {
    const vol = chopstickCaptureVolume(DEFAULT_TOWER_STATE);
    expect(BoosterDescentCalm.targetCatch.targetPosition).toEqual(vol.center);
    // Sanity: the slot is on the +x arm side, not the tower centreline.
    expect(vol.center.x).toBeGreaterThan(5);
  });
});

describe("evaluateCatch", () => {
  const envelope = BoosterDescentStandard.targetCatch;
  const target = envelope.targetPosition;

  it("a perfect catch reports caught: true", () => {
    const w = {
      ...BoosterDescentStandard.initialWorld,
      rigidBody: {
        ...BoosterDescentStandard.initialWorld.rigidBody,
        position: target,
        velocity: Vec3.of(0, 0, 0),
        attitude: { x: 0, y: 0, z: 0, w: 1 },
        angularVelocity: Vec3.of(0, 0, 0),
      },
    };
    expect(evaluateCatch(w, envelope)).toEqual({
      caught: true,
      reason: "within catch envelope",
    });
  });

  it("a high vertical speed flags the verdict + cites it", () => {
    const w = {
      ...BoosterDescentStandard.initialWorld,
      rigidBody: {
        ...BoosterDescentStandard.initialWorld.rigidBody,
        position: target,
        velocity: Vec3.of(0, -10, 0),
        attitude: { x: 0, y: 0, z: 0, w: 1 },
        angularVelocity: Vec3.of(0, 0, 0),
      },
    };
    const v = evaluateCatch(w, envelope);
    expect(v.caught).toBe(false);
    expect(v.reason.toLowerCase()).toContain("vertical");
  });

  it("position miss is reported with the magnitude", () => {
    const w = {
      ...BoosterDescentStandard.initialWorld,
      rigidBody: {
        ...BoosterDescentStandard.initialWorld.rigidBody,
        position: Vec3.of(target.x + 50, target.y, target.z),
        velocity: Vec3.of(0, 0, 0),
        attitude: { x: 0, y: 0, z: 0, w: 1 },
        angularVelocity: Vec3.of(0, 0, 0),
      },
    };
    const v = evaluateCatch(w, envelope);
    expect(v.caught).toBe(false);
    expect(v.reason.toLowerCase()).toContain("position");
  });
});
