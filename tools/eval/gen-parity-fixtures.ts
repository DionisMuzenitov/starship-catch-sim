/**
 * Generate golden TS→Python parity fixtures (SLS-28 / R1).
 *
 * For each fixture we take a scenario's initial world, drive it for 1 s at
 * PHYSICS_DT with a DETERMINISTIC control sequence, and record both the
 * control at each step and the resulting rigid-body + fuel state. The Python
 * numpy port (`services/rl`) replays the *recorded* control sequence (it does
 * not regenerate it — sidestepping cross-language PRNG parity) and asserts the
 * per-step state matches within 1e-4. Any equation drift between the TS plant
 * and the numpy port fails `services/rl/tests/test_equivalence.py` in CI.
 *
 * Wind is CALM for every fixture: the equivalence test compares the *plant*,
 * not the stateful Dryden turbulence RNG (which is not a bit-exact contract).
 *
 * Run: `pnpm gen:parity-fixtures`.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  BoosterVehicle,
  ShipVehicle,
  constantWind,
  currentInertia,
  currentMass,
  scenarioById,
  simStep,
  Vec3,
  type ControlInput,
  type SimEnv,
  type Vehicle,
  type World,
} from "../../packages/physics/src/index.js";

const PHYSICS_DT = 1 / 250;
const STEPS = 250; // 1 second.

// Deterministic splitmix32 — used only on the TS side to synthesise varied
// control inputs; the values are recorded, never regenerated in Python.
function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

type ProfileKind = "booster" | "ship";

/** Build a control input for step `i` that exercises engines, gimbal, and
 *  surfaces so the fixture covers every force/torque path. */
function controlAt(
  kind: ProfileKind,
  i: number,
  rng: () => number,
  finCount: number,
  flapCount: number,
): ControlInput {
  const t = i * PHYSICS_DT;
  // Throttle ramps up over the second with a little per-step jitter.
  const base = Math.min(1, 0.4 + 0.5 * t + 0.05 * (rng() - 0.5));
  const gimbalPitch = 0.15 * Math.sin(6 * t) + 0.02 * (rng() - 0.5);
  const gimbalYaw = 0.12 * Math.cos(5 * t);
  const finDefl = 0.2 * Math.sin(4 * t + 1);
  const fins = Array.from({ length: finCount }, (_, k) =>
    finDefl * (k % 2 === 0 ? 1 : -1),
  );
  const flaps = Array.from({ length: flapCount }, (_, k) =>
    0.3 * Math.sin(3 * t) * (k % 2 === 0 ? 1 : -1),
  );
  if (kind === "ship") {
    return {
      engineGroups: { centre: 0, inner: 0, outer: 0, ship: base },
      enginesOn: { centre: false, inner: false, outer: false, ship: true },
      gimbalPitch,
      gimbalYaw,
      fins,
      flaps,
    };
  }
  return {
    engineGroups: { centre: base, inner: 0.8 * base, outer: 0, ship: 0 },
    enginesOn: { centre: true, inner: true, outer: false, ship: false },
    gimbalPitch,
    gimbalYaw,
    fins,
    flaps,
  };
}

function serializeState(w: World) {
  return {
    position: [
      w.rigidBody.position.x,
      w.rigidBody.position.y,
      w.rigidBody.position.z,
    ],
    velocity: [
      w.rigidBody.velocity.x,
      w.rigidBody.velocity.y,
      w.rigidBody.velocity.z,
    ],
    attitude: [
      w.rigidBody.attitude.x,
      w.rigidBody.attitude.y,
      w.rigidBody.attitude.z,
      w.rigidBody.attitude.w,
    ],
    angularVelocity: [
      w.rigidBody.angularVelocity.x,
      w.rigidBody.angularVelocity.y,
      w.rigidBody.angularVelocity.z,
    ],
    mass: w.rigidBody.mass,
    propellantMass: w.mass.propellantMass,
  };
}

function serializeControl(c: ControlInput) {
  return {
    engineGroups: c.engineGroups,
    enginesOn: c.enginesOn,
    gimbalPitch: c.gimbalPitch,
    gimbalYaw: c.gimbalYaw,
    fins: c.fins,
    flaps: c.flaps,
  };
}

type FixtureSpec = {
  name: string;
  scenarioId: string;
  kind: ProfileKind;
  seed: number;
  /** Override the starting propellant (kg) to exercise the fuel-depletion gate
   *  (SLS-78): the tank drains mid-run so the fixture crosses fuelScale < 1 and
   *  fuelScale == 0, verifying the gate matches bit-close across the ports. */
  initialPropellantMass?: number;
};

const FIXTURES: FixtureSpec[] = [
  {
    name: "booster-descent-a",
    scenarioId: "booster-descent-calm",
    kind: "booster",
    seed: 1,
  },
  {
    name: "booster-descent-b",
    scenarioId: "booster-descent-standard",
    kind: "booster",
    seed: 2,
  },
  {
    name: "booster-descent-c",
    scenarioId: "booster-descent-stormy",
    kind: "booster",
    seed: 3,
  },
  {
    name: "ship-descent-a",
    scenarioId: "ship-descent-calm",
    kind: "ship",
    seed: 4,
  },
  {
    name: "ship-descent-b",
    scenarioId: "ship-descent-standard",
    kind: "ship",
    seed: 5,
  },
  {
    // Burn-to-empty: a tiny reserve so full-ramp thrust drains the tank part
    // way through the 1 s run, exercising the SLS-78 fuel gate's partial
    // (fuelScale < 1) and empty (fuelScale == 0) branches under the parity
    // contract — the rest of the suite never leaves the tank near full.
    name: "booster-depletion",
    scenarioId: "booster-descent-calm",
    kind: "booster",
    seed: 6,
    initialPropellantMass: 2000,
  },
];

function vehicleFor(kind: ProfileKind): Vehicle {
  return kind === "ship" ? ShipVehicle : BoosterVehicle;
}

// Numeric-tolerant compare — the 1 s integrations accumulate last-ULP
// transcendental differences across Node/V8 builds, so a byte-exact freshness
// check is fragile in CI. A real physics *equation* change is far larger than
// 1e-6 relative, so drift is still caught (R1).
function deepClose(a: unknown, b: unknown, rtol = 1e-6): boolean {
  if (typeof a === "number" && typeof b === "number") {
    if (a === b) return true;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
    return Math.abs(a - b) <= rtol * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => deepClose(x, b[i], rtol));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    return (
      ka.length === kb.length &&
      ka.every((k) =>
        deepClose(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
          rtol,
        ),
      )
    );
  }
  return a === b;
}

const checkMode = process.argv.includes("--check");
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "services", "rl", "tests", "fixtures");
mkdirSync(outDir, { recursive: true });
let stale = 0;

// CALM env for every fixture — wind excluded from the parity contract.
const calmEnv: SimEnv = { wind: constantWind(Vec3.ZERO), gravity: 9.80665 };

for (const spec of FIXTURES) {
  const scenario = scenarioById(spec.scenarioId);
  const vehicle = vehicleFor(spec.kind);
  const finCount = vehicle.surfaces.filter((s) => s.kind === "grid_fin").length;
  const flapCount = vehicle.surfaces.filter((s) => s.kind === "flap").length;
  const rng = splitmix32(spec.seed);

  // Optionally start with a reduced tank (fuel-depletion fixture, SLS-78),
  // recomputing the derived rigid-body mass + inertia to stay consistent.
  let world = scenario.initialWorld;
  if (spec.initialPropellantMass !== undefined) {
    const mass = { ...world.mass, propellantMass: spec.initialPropellantMass };
    world = {
      ...world,
      mass,
      rigidBody: {
        ...world.rigidBody,
        mass: currentMass(mass),
        inertia: currentInertia(mass),
      },
    };
  }
  const initialWorld0 = world; // snapshot before the loop mutates `world`
  const controls: ReturnType<typeof serializeControl>[] = [];
  const states: ReturnType<typeof serializeState>[] = [];

  for (let i = 0; i < STEPS; i++) {
    const control = controlAt(spec.kind, i, rng, finCount, flapCount);
    controls.push(serializeControl(control));
    world = simStep(world, vehicle, control, PHYSICS_DT, calmEnv);
    states.push(serializeState(world));
  }

  const fixture = {
    schemaVersion: 1,
    name: spec.name,
    scenarioId: spec.scenarioId,
    vehicle: spec.kind,
    dt: PHYSICS_DT,
    steps: STEPS,
    initialWorld: {
      rigidBody: {
        position: [
          initialWorld0.rigidBody.position.x,
          initialWorld0.rigidBody.position.y,
          initialWorld0.rigidBody.position.z,
        ],
        velocity: [
          initialWorld0.rigidBody.velocity.x,
          initialWorld0.rigidBody.velocity.y,
          initialWorld0.rigidBody.velocity.z,
        ],
        attitude: [
          initialWorld0.rigidBody.attitude.x,
          initialWorld0.rigidBody.attitude.y,
          initialWorld0.rigidBody.attitude.z,
          initialWorld0.rigidBody.attitude.w,
        ],
        angularVelocity: [
          initialWorld0.rigidBody.angularVelocity.x,
          initialWorld0.rigidBody.angularVelocity.y,
          initialWorld0.rigidBody.angularVelocity.z,
        ],
        mass: initialWorld0.rigidBody.mass,
      },
      propellantMass: initialWorld0.mass.propellantMass,
    },
    controls,
    states,
  };

  const outPath = join(outDir, `${spec.name}.json`);
  if (checkMode) {
    if (!existsSync(outPath) || !deepClose(fixture, JSON.parse(readFileSync(outPath, "utf8")))) {
      console.error(`::error::${spec.name}.json is STALE — run \`pnpm gen:parity-fixtures\` and commit`);
      stale++;
    }
  } else {
    writeFileSync(outPath, JSON.stringify(fixture) + "\n");
    const last = states[states.length - 1]!;
    console.log(
      `${spec.name}: ${STEPS} steps → final y=${last.position[1]!.toFixed(1)} ` +
        `m, prop=${last.propellantMass.toFixed(0)} kg`,
    );
  }
}

if (checkMode) {
  if (stale > 0) process.exit(1);
  console.log("parity fixtures are up to date (numeric-tolerant check).");
} else {
  console.log(`wrote ${FIXTURES.length} fixtures to ${outDir}`);
}
