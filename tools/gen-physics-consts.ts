/**
 * Single-source the physics constants for the RL numpy port (SLS-28 / R1).
 *
 * The TypeScript physics core is the ONE source of truth. This script imports
 * the real runtime objects (engine + surface presets, scenario initial worlds,
 * atmosphere / drag tables, catch envelopes) and serialises them to
 * `services/rl/rl_consts.json`, which the Python port (`services/rl`) and the
 * MPC service (`services/mpc`) consume. A CI check regenerates this file and
 * fails on any diff, so a constant can never drift between the languages —
 * closing risk R1 (previously "keep verbatim in sync" comments, which had
 * already drifted across the mpc test files).
 *
 * Run: `pnpm gen:consts`  (writes the JSON; `--check` exits non-zero if stale).
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  BoosterVehicle,
  ShipVehicle,
  SCENARIOS,
  SuperHeavyMass,
  StarshipMass,
  DEFAULT_TOWER_STATE,
  chopstickCaptureVolume,
  towerStructureAabb,
  RHO0,
  P0,
  H_RHO,
  H_P,
  GAMMA_AIR,
  R_AIR,
  ISA_LAYERS,
  CD_MACH_TABLE,
  G0,
  type Engine,
  type Surface,
  type MassProperties,
  type Vehicle,
  type World,
  type CatchEnvelope,
  type Scenario,
  type Vec3,
} from "../packages/physics/src/index.js";

// Fixed integrator timestep — mirrors the runner + eval harness
// (apps/web/src/sim/runner.ts, packages/controllers/src/eval/monteCarlo.ts).
const PHYSICS_DT = 1 / 250;

const v3 = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];
const q4 = (q: {
  x: number;
  y: number;
  z: number;
  w: number;
}): [number, number, number, number] => [q.x, q.y, q.z, q.w];
const mat9 = (m: readonly number[]): number[] => [...m];

function engine(e: Engine) {
  return {
    mount: v3(e.mount),
    direction: v3(e.direction),
    thrustVac: e.thrustVac,
    thrustSea: e.thrustSea,
    ispVac: e.ispVac,
    ispSea: e.ispSea,
    maxGimbal: e.maxGimbal,
    maxGimbalRate: e.maxGimbalRate,
    minThrottle: e.minThrottle,
    tauThrottle: e.tauThrottle,
    tauGimbal: e.tauGimbal,
    canGimbal: e.canGimbal,
  };
}

function surface(s: Surface) {
  return {
    kind: s.kind,
    mount: v3(s.mount),
    hingeAxisBody: v3(s.hingeAxisBody),
    zeroDeflectionNormalBody: v3(s.zeroDeflectionNormalBody),
    area: s.area,
    clAlpha: s.clAlpha,
    cd0: s.cd0,
    maxDeflection: s.maxDeflection,
    maxDeflectionRate: s.maxDeflectionRate,
    alphaStall: s.alphaStall,
    tau: s.tau,
  };
}

function massProps(m: MassProperties) {
  return {
    dryMass: m.dryMass,
    propellantMass: m.propellantMass,
    dryCoM: v3(m.dryCoM),
    dryInertia: mat9(m.dryInertia),
    tankBottom: m.tankBottom,
    tankTop: m.tankTop,
    tankRadius: m.tankRadius,
    propellantDensity: m.propellantDensity,
  };
}

function vehicle(vh: Vehicle) {
  return {
    engines: vh.engines.map(engine),
    engineGroupOf: [...vh.engineGroupOf],
    surfaces: vh.surfaces.map(surface),
    surfaceCtlIndexOf: [...vh.surfaceCtlIndexOf],
    bodyRefArea: vh.bodyRefArea,
    bodyCd: vh.bodyCd,
  };
}

function world(w: World) {
  return {
    rigidBody: {
      position: v3(w.rigidBody.position),
      velocity: v3(w.rigidBody.velocity),
      attitude: q4(w.rigidBody.attitude),
      angularVelocity: v3(w.rigidBody.angularVelocity),
      mass: w.rigidBody.mass,
      inertia: mat9(w.rigidBody.inertia),
    },
    mass: massProps(w.mass),
    engineStates: w.engineStates.map((s) => ({
      gimbalPitch: s.gimbalPitch,
      gimbalYaw: s.gimbalYaw,
      throttle: s.throttle,
      on: s.on,
    })),
    surfaceStates: w.surfaceStates.map((s) => ({ deflection: s.deflection })),
    t: w.t,
  };
}

function envelope(e: CatchEnvelope) {
  return {
    targetPosition: v3(e.targetPosition),
    positionTolM: e.positionTolM,
    verticalSpeedTolMps: e.verticalSpeedTolMps,
    horizontalSpeedTolMps: e.horizontalSpeedTolMps,
    attitudeTiltTolRad: e.attitudeTiltTolRad,
    angularRateTolRadPerS: e.angularRateTolRadPerS,
  };
}

// Wind spec per difficulty — mirrors scenarios.ts. Wind is env randomization,
// not on the parity-critical plant path (equivalence fixtures use calm wind),
// so a light structured mirror is fine; the numpy env rebuilds an equivalent
// field (Dryden turbulence is a distribution, not a bit-exact requirement).
function windSpec(difficulty: string) {
  if (difficulty === "calm") return { kind: "constant", value: [0, 0, 0] };
  if (difficulty === "standard")
    return {
      kind: "layered",
      layers: [
        { altitude: 0, wind: [5, 0, 0] },
        { altitude: 10_000, wind: [12, 0, 0] },
        { altitude: 30_000, wind: [20, 0, 0] },
        { altitude: 65_000, wind: [20, 0, 0] },
      ],
    };
  return {
    kind: "combined",
    layers: [
      { altitude: 0, wind: [15, 0, 5] },
      { altitude: 5_000, wind: [25, 0, 5] },
      { altitude: 20_000, wind: [35, 0, 0] },
      { altitude: 65_000, wind: [35, 0, 0] },
    ],
    dryden: { sigma: [6, 1, 6], tau: [2, 2, 2], seed: 42 },
  };
}

function scenario(s: Scenario) {
  return {
    id: s.id,
    name: s.name,
    difficulty: s.difficulty,
    vehicle: s.vehicle === ShipVehicle ? "ship" : "booster",
    initialWorld: world(s.initialWorld),
    env: { gravity: s.env.gravity, wind: windSpec(s.difficulty) },
    targetCatch: envelope(s.targetCatch),
  };
}

const consts = {
  schemaVersion: 1,
  generatedBy: "tools/gen-physics-consts.ts (SLS-28)",
  physicsDt: PHYSICS_DT,
  g0: G0,
  atmosphere: {
    rho0: RHO0,
    p0: P0,
    hRho: H_RHO,
    hP: H_P,
    gammaAir: GAMMA_AIR,
    rAir: R_AIR,
    isaLayers: ISA_LAYERS.map((l) => [...l]),
  },
  dragCdMachTable: CD_MACH_TABLE.map((r) => [...r]),
  massPresets: {
    superHeavy: massProps(SuperHeavyMass),
    starship: massProps(StarshipMass),
  },
  vehicles: {
    booster: vehicle(BoosterVehicle),
    ship: vehicle(ShipVehicle),
  },
  // Mechazilla catch geometry (default tower state) — the RL env uses the
  // capture volume for `caught` and the structure AABB for `tower_collision`.
  tower: (() => {
    const cap = chopstickCaptureVolume(DEFAULT_TOWER_STATE);
    const struct = towerStructureAabb(DEFAULT_TOWER_STATE);
    return {
      // AABBs are center + halfExtents (pointInAabb: |p−center| ≤ halfExtents).
      captureVolume: { center: v3(cap.center), halfExtents: v3(cap.halfExtents) },
      structureAabb: {
        center: v3(struct.center),
        halfExtents: v3(struct.halfExtents),
      },
    };
  })(),
  scenarios: SCENARIOS.map(scenario),
};

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "services", "rl", "rl_consts.json");
const json = JSON.stringify(consts, null, 2) + "\n";

/**
 * Deep numeric-tolerant equality. The JSON holds trig-derived values (engine
 * ring mounts via sin/cos, the retrograde attitude via acos) whose LAST ULP
 * varies across Node/V8 builds and platforms — so a byte-exact `===` check is
 * fragile in CI. We compare structure exactly and numbers within a tight
 * relative tolerance: a REAL constant change is orders of magnitude larger
 * than a last-ULP transcendental difference, so drift is still caught (R1).
 */
function deepClose(a: unknown, b: unknown, rtol = 1e-9): boolean {
  if (typeof a === "number" && typeof b === "number") {
    if (a === b) return true;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
    return Math.abs(a - b) <= rtol * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepClose(x, b[i], rtol));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) =>
      deepClose(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        rtol,
      ),
    );
  }
  return a === b;
}

const check = process.argv.includes("--check");
if (check) {
  if (!existsSync(outPath)) {
    console.error("rl_consts.json is MISSING — run `pnpm gen:consts` and commit.");
    process.exit(1);
  }
  const committed = JSON.parse(readFileSync(outPath, "utf8"));
  if (!deepClose(committed, consts)) {
    console.error(
      `rl_consts.json is STALE — run \`pnpm gen:consts\` and commit.\n` +
        `(a physics constant changed but the generated JSON was not regenerated — R1)`,
    );
    process.exit(1);
  }
  console.log("rl_consts.json is up to date (numeric-tolerant check).");
} else {
  writeFileSync(outPath, json);
  console.log(`wrote ${outPath} (${json.length} bytes)`);
}
