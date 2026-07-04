/**
 * Scenario library — paired (vehicle, world, env, target, criteria)
 * bundles you can load into the simulator. v1 ships the three
 * Booster-Descent variants (Calm / Standard / Stormy) plus a
 * `boosterDescentScenario()` convenience that returns the Standard
 * variant (used by tests + the default sim store).
 *
 * Initial conditions per SLS-20:
 *  - Position (0, 65 000, 50 000) m — 65 km up, 50 km in +Z (north)
 *  - Velocity (0, -200, -300) m/s — descending toward the tower at the
 *    origin. (The ticket's nominal `(-300, -200, 0)` was reinterpreted
 *    so the booster actually returns to the pad; see the plan comment.)
 *  - Attitude: nose pointing retrograde (opposite the descent vector).
 *  - Fuel: ~10 % of full tank capacity.
 *
 * The three variants differ only in the wind field — Calm has no wind,
 * Standard adds a mild westerly with a Dryden gust, Stormy adds heavier
 * Dryden turbulence on top of a layered wind profile.
 */

import type { SurfaceState } from "./aero.js";
import { BoosterFins } from "./presets/booster-fins.js";
import { ShipFlaps } from "./presets/ship-flaps.js";
import {
  consumeFuel,
  currentInertia,
  currentMass,
  full,
  tankCapacity,
} from "./mass.js";
import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";
import { StarshipMass } from "./presets/starship.js";
import { SuperHeavyMass } from "./presets/super-heavy.js";
import { StarshipEngines } from "./presets/starship-engines.js";
import { SuperHeavyEngines } from "./presets/super-heavy-engines.js";
import { createRigidBody } from "./state.js";
import type { EngineState } from "./thrust.js";
import { initialEngineState } from "./thrust.js";
import type { EngineGroup } from "./control.js";
import {
  constantWind,
  drydenTurbulence,
  layeredWind,
  type WindField,
} from "./wind.js";
import {
  defineVehicle,
  type SimEnv,
  type Vehicle,
  type World,
} from "./world.js";
import { chopstickCaptureVolume, DEFAULT_TOWER_STATE } from "./tower.js";

// ---------------------------------------------------------------------------
// Static vehicle config — used by every scenario in v1.
// ---------------------------------------------------------------------------

const boosterEngineGroupOf: readonly EngineGroup[] = [
  ...Array<EngineGroup>(3).fill("centre"),
  ...Array<EngineGroup>(10).fill("inner"),
  ...Array<EngineGroup>(20).fill("outer"),
];

const BOOSTER_REF_AREA = Math.PI * 4.5 * 4.5;
const BOOSTER_CD = 0.7;

export const BoosterVehicle: Vehicle = defineVehicle({
  engines: SuperHeavyEngines,
  engineGroupOf: boosterEngineGroupOf,
  surfaces: BoosterFins,
  bodyRefArea: BOOSTER_REF_AREA,
  bodyCd: BOOSTER_CD,
});

// ---------------------------------------------------------------------------
// Ship vehicle — all 6 Raptors live in the single `ship` engine group; the
// belly-flop attitude exposes a much larger aero profile than a vertical
// stack, so the body Cd is bumped accordingly.
// ---------------------------------------------------------------------------

const shipEngineGroupOf: readonly EngineGroup[] = Array<EngineGroup>(
  StarshipEngines.length,
).fill("ship");

const SHIP_REF_AREA = Math.PI * 4.5 * 4.5;
const SHIP_CD = 0.9;

export const ShipVehicle: Vehicle = defineVehicle({
  engines: StarshipEngines,
  engineGroupOf: shipEngineGroupOf,
  surfaces: ShipFlaps,
  bodyRefArea: SHIP_REF_AREA,
  bodyCd: SHIP_CD,
});

// ---------------------------------------------------------------------------
// Catch envelope + verdict shape
// ---------------------------------------------------------------------------

export type CatchEnvelope = {
  /** World-frame target (tower catch points, between the chopsticks). */
  readonly targetPosition: Vec3;
  /** 3D position tolerance (m). */
  readonly positionTolM: number;
  /** |v_y| tolerance (m/s). */
  readonly verticalSpeedTolMps: number;
  /** |v_horiz| tolerance (m/s). */
  readonly horizontalSpeedTolMps: number;
  /** Tilt from upright (rad). */
  readonly attitudeTiltTolRad: number;
  /** Angular rate magnitude tolerance (rad/s). */
  readonly angularRateTolRadPerS: number;
};

export type SuccessVerdict = {
  readonly caught: boolean;
  /** Human-readable reason — describes the worst violation. */
  readonly reason: string;
};

// Catch point = the centre of the physical chopstick capture volume
// (≈ (8.5, 91, 0)), derived from the tower geometry so it can never
// drift from what the catch detector actually gates on. The previous
// hand-written (0, 91, 0) sat on the tower CENTRELINE — outside the
// capture volume and inside the tower truss AABB, so a controller
// tracking it perfectly ended in `tower_collision`, never `caught`
// (SLS-48 verification finding).
const CATCH_POINT_WORLD = chopstickCaptureVolume(DEFAULT_TOWER_STATE).center;

const STANDARD_CATCH_ENVELOPE: CatchEnvelope = {
  targetPosition: CATCH_POINT_WORLD,
  positionTolM: 10,
  verticalSpeedTolMps: 5,
  horizontalSpeedTolMps: 2,
  attitudeTiltTolRad: (3 * Math.PI) / 180,
  angularRateTolRadPerS: (5 * Math.PI) / 180,
};

/**
 * Evaluate a `World` against a `CatchEnvelope`. The first violation found
 * wins the `reason` string; this keeps the diagnostic stable + readable.
 */
export function evaluateCatch(
  world: World,
  envelope: CatchEnvelope,
): SuccessVerdict {
  const r = world.rigidBody.position;
  const v = world.rigidBody.velocity;
  const t = envelope.targetPosition;
  const distance = Math.hypot(r.x - t.x, r.y - t.y, r.z - t.z);
  if (distance > envelope.positionTolM) {
    return {
      caught: false,
      reason: `position off by ${distance.toFixed(1)} m (limit ${envelope.positionTolM} m)`,
    };
  }
  if (Math.abs(v.y) > envelope.verticalSpeedTolMps) {
    return {
      caught: false,
      reason: `vertical speed ${v.y.toFixed(2)} m/s (limit ${envelope.verticalSpeedTolMps} m/s)`,
    };
  }
  const vh = Math.hypot(v.x, v.z);
  if (vh > envelope.horizontalSpeedTolMps) {
    return {
      caught: false,
      reason: `horizontal speed ${vh.toFixed(2)} m/s (limit ${envelope.horizontalSpeedTolMps} m/s)`,
    };
  }
  // Tilt: angle between body +Y (in world frame) and world +Y.
  const bodyUpWorld = Quat.rotateVec3(
    world.rigidBody.attitude,
    Vec3.of(0, 1, 0),
  );
  const tiltRad = Math.acos(Math.max(-1, Math.min(1, bodyUpWorld.y)));
  if (tiltRad > envelope.attitudeTiltTolRad) {
    const tiltDeg = (tiltRad * 180) / Math.PI;
    return {
      caught: false,
      reason: `tilt ${tiltDeg.toFixed(1)}° (limit ${((envelope.attitudeTiltTolRad * 180) / Math.PI).toFixed(1)}°)`,
    };
  }
  const omega = Math.hypot(
    world.rigidBody.angularVelocity.x,
    world.rigidBody.angularVelocity.y,
    world.rigidBody.angularVelocity.z,
  );
  if (omega > envelope.angularRateTolRadPerS) {
    return {
      caught: false,
      reason: `angular rate ${omega.toFixed(3)} rad/s (limit ${envelope.angularRateTolRadPerS.toFixed(3)} rad/s)`,
    };
  }
  return { caught: true, reason: "within catch envelope" };
}

// ---------------------------------------------------------------------------
// Scenario type + variants
// ---------------------------------------------------------------------------

export type ScenarioDifficulty = "calm" | "standard" | "stormy";

export type Scenario = {
  readonly id: string;
  readonly name: string;
  readonly difficulty: ScenarioDifficulty;
  readonly vehicle: Vehicle;
  readonly initialWorld: World;
  readonly env: SimEnv;
  readonly targetCatch: CatchEnvelope;
  readonly successCriteria: (world: World) => SuccessVerdict;
};

const INITIAL_POSITION = Vec3.of(0, 65_000, 50_000);
/**
 * Velocity reinterpreted from SLS-20's literal `(-300, -200, 0)`. The
 * original moves the booster *west* (-X), away from the +Z=50 km start;
 * it never returns to the pad at the origin. Reinterpreted as
 * `(0, -200, -300)` — 200 m/s descent + 300 m/s south toward the
 * tower — so the trajectory actually leads home. Magnitude (≈ 360 m/s)
 * unchanged.
 */
const INITIAL_VELOCITY = Vec3.of(0, -200, -300);

/** Attitude pointing retrograde: body +Y aligns with the anti-velocity
 * unit vector. */
const RETROGRADE_ATTITUDE: Quat = (() => {
  const v = INITIAL_VELOCITY;
  const speed = Math.hypot(v.x, v.y, v.z);
  // Unit vector opposite to motion (retrograde / "nose-up" direction).
  const nx = -v.x / speed;
  const ny = -v.y / speed;
  const nz = -v.z / speed;
  // Rotate body +Y = (0,1,0) onto (nx, ny, nz). Rotation axis is the
  // cross-product of (0,1,0) and the target; angle is acos(target.y).
  const axisX = nz; //  (0,1,0) × (nx, ny, nz) = ( nz, 0, -nx )
  const axisY = 0;
  const axisZ = -nx;
  const axisLen = Math.hypot(axisX, axisY, axisZ);
  if (axisLen < 1e-9) return Quat.IDENTITY;
  const angle = Math.acos(Math.max(-1, Math.min(1, ny)));
  return Quat.fromAxisAngle(
    Vec3.of(axisX / axisLen, axisY / axisLen, axisZ / axisLen),
    angle,
  );
})();

const INITIAL_FUEL_FRACTION = 0.1;

function makeInitialWorld(env: SimEnv): World {
  void env; // env is per-scenario state, not per-world — reserved.
  const initialMass = consumeFuel(
    full(SuperHeavyMass),
    (1 - INITIAL_FUEL_FRACTION) * tankCapacity(SuperHeavyMass),
  );
  const rigidBody = createRigidBody({
    mass: currentMass(initialMass),
    inertia: currentInertia(initialMass),
    position: INITIAL_POSITION,
    velocity: INITIAL_VELOCITY,
    attitude: RETROGRADE_ATTITUDE,
    angularVelocity: Vec3.ZERO,
  });
  const engineStates: readonly EngineState[] = SuperHeavyEngines.map(() =>
    initialEngineState(),
  );
  const surfaceStates: readonly SurfaceState[] = BoosterFins.map(() => ({
    deflection: 0,
  }));
  return {
    rigidBody,
    mass: initialMass,
    engineStates,
    surfaceStates,
    t: 0,
  };
}

// ---------------------------------------------------------------------------
// Wind variants per difficulty
// ---------------------------------------------------------------------------

// Wind fields are FACTORIES, not singletons: the Dryden turbulence field
// is stateful (seeded PRNG + OU state + a time high-water mark), so a
// shared instance freezes into a constant gust for any consumer whose
// sim time is below another consumer's — repeat Monte-Carlo runs saw
// order-dependent, non-reproducible stormy wind (SLS-48 finding). Every
// scenario instantiation gets a fresh field; `scenarioById` rebuilds.
const calmWind = (): WindField => constantWind(Vec3.ZERO);

// Mild westerly that strengthens with altitude — gives the player a
// gentle but real environmental disturbance.
const standardWind = (): WindField =>
  layeredWind([
    { altitude: 0, wind: Vec3.of(5, 0, 0) },
    { altitude: 10_000, wind: Vec3.of(12, 0, 0) },
    { altitude: 30_000, wind: Vec3.of(20, 0, 0) },
    { altitude: 65_000, wind: Vec3.of(20, 0, 0) },
  ]);

// Stormy: layered base + Dryden turbulence (sums via a small combinator).
// Seeded, so every freshly built field reproduces the same gust sequence.
function combinedWind(base: WindField, gust: WindField): WindField {
  return {
    at(position, time) {
      return Vec3.add(base.at(position, time), gust.at(position, time));
    },
  };
}

const stormyWind = (): WindField =>
  combinedWind(
    layeredWind([
      { altitude: 0, wind: Vec3.of(15, 0, 5) },
      { altitude: 5_000, wind: Vec3.of(25, 0, 5) },
      { altitude: 20_000, wind: Vec3.of(35, 0, 0) },
      { altitude: 65_000, wind: Vec3.of(35, 0, 0) },
    ]),
    drydenTurbulence({
      sigma: Vec3.of(6, 1, 6),
      tau: Vec3.of(2, 2, 2),
      seed: 42,
    }),
  );

const G = 9.80665;

function buildScenario(
  id: string,
  name: string,
  difficulty: ScenarioDifficulty,
  windFactory: () => WindField,
): Scenario {
  const env: SimEnv = { wind: windFactory(), gravity: G };
  const initialWorld = makeInitialWorld(env);
  return {
    id,
    name,
    difficulty,
    vehicle: BoosterVehicle,
    initialWorld,
    env,
    targetCatch: STANDARD_CATCH_ENVELOPE,
    successCriteria: (world) => evaluateCatch(world, STANDARD_CATCH_ENVELOPE),
  };
}

export const BoosterDescentCalm: Scenario = buildScenario(
  "booster-descent-calm",
  "Booster Descent — Calm",
  "calm",
  calmWind,
);

export const BoosterDescentStandard: Scenario = buildScenario(
  "booster-descent-standard",
  "Booster Descent — Standard",
  "standard",
  standardWind,
);

export const BoosterDescentStormy: Scenario = buildScenario(
  "booster-descent-stormy",
  "Booster Descent — Stormy",
  "stormy",
  stormyWind,
);

// ---------------------------------------------------------------------------
// Ship Descent variants — belly-flop entry → flip → catch attempt.
// ---------------------------------------------------------------------------

const SHIP_INITIAL_POSITION = Vec3.of(-100_000, 100_000, 0);
const SHIP_INITIAL_VELOCITY = Vec3.of(1500, -200, 0);
/**
 * Belly-flop attitude: body +Y aligned with world +X (nose pointing
 * prograde along the velocity vector). Rotating (0,1,0) onto (1,0,0)
 * is a -π/2 turn about world +Z.
 */
const SHIP_BELLYFLOP_ATTITUDE: Quat = Quat.fromAxisAngle(
  Vec3.of(0, 0, 1),
  -Math.PI / 2,
);
/** ~6 % propellant left — typical post-orbit return reserve. */
const SHIP_INITIAL_FUEL_FRACTION = 0.06;
/** All 4 flaps deployed at +20° uniformly so the ship presents area to
 * the airstream from t=0. */
const SHIP_INITIAL_FLAP_DEFLECTION = (20 * Math.PI) / 180;

/** Tighter than the booster envelope — Starship is the precision pass. */
const SHIP_CATCH_ENVELOPE: CatchEnvelope = {
  targetPosition: CATCH_POINT_WORLD,
  positionTolM: 8,
  verticalSpeedTolMps: 3,
  horizontalSpeedTolMps: 1,
  attitudeTiltTolRad: (3 * Math.PI) / 180,
  angularRateTolRadPerS: (5 * Math.PI) / 180,
};

function makeShipInitialWorld(): World {
  const initialMass = consumeFuel(
    full(StarshipMass),
    (1 - SHIP_INITIAL_FUEL_FRACTION) * tankCapacity(StarshipMass),
  );
  const rigidBody = createRigidBody({
    mass: currentMass(initialMass),
    inertia: currentInertia(initialMass),
    position: SHIP_INITIAL_POSITION,
    velocity: SHIP_INITIAL_VELOCITY,
    attitude: SHIP_BELLYFLOP_ATTITUDE,
    angularVelocity: Vec3.ZERO,
  });
  const engineStates: readonly EngineState[] = StarshipEngines.map(() =>
    initialEngineState(),
  );
  const surfaceStates: readonly SurfaceState[] = ShipFlaps.map(() => ({
    deflection: SHIP_INITIAL_FLAP_DEFLECTION,
  }));
  return {
    rigidBody,
    mass: initialMass,
    engineStates,
    surfaceStates,
    t: 0,
  };
}

// Ship stormy wind: independent Dryden seed so booster + ship scenarios
// don't share gust sequences. A factory like the booster winds.
const stormyWindShip = (): WindField =>
  combinedWind(
    layeredWind([
      { altitude: 0, wind: Vec3.of(15, 0, 5) },
      { altitude: 5_000, wind: Vec3.of(25, 0, 5) },
      { altitude: 20_000, wind: Vec3.of(35, 0, 0) },
      { altitude: 65_000, wind: Vec3.of(35, 0, 0) },
    ]),
    drydenTurbulence({
      sigma: Vec3.of(6, 1, 6),
      tau: Vec3.of(2, 2, 2),
      seed: 73,
    }),
  );

const shipWindByDifficulty: Record<ScenarioDifficulty, () => WindField> = {
  calm: calmWind,
  standard: standardWind,
  stormy: stormyWindShip,
};

/**
 * Ship success criteria: evaluate the catch envelope normally, but if the
 * verdict is a miss AND propellant has run out before reaching the tower,
 * report `fuel exhausted` — this is the dominant failure mode at low
 * starting fuel and the catch-envelope reason would mislead the player.
 */
function shipSuccessCriteria(world: World): SuccessVerdict {
  const verdict = evaluateCatch(world, SHIP_CATCH_ENVELOPE);
  if (verdict.caught) return verdict;
  if (world.mass.propellantMass <= 0) {
    return { caught: false, reason: "fuel exhausted before catch" };
  }
  return verdict;
}

function buildShipScenario(
  id: string,
  name: string,
  difficulty: ScenarioDifficulty,
): Scenario {
  const env: SimEnv = { wind: shipWindByDifficulty[difficulty](), gravity: G };
  const initialWorld = makeShipInitialWorld();
  return {
    id,
    name,
    difficulty,
    vehicle: ShipVehicle,
    initialWorld,
    env,
    targetCatch: SHIP_CATCH_ENVELOPE,
    successCriteria: shipSuccessCriteria,
  };
}

export const ShipDescentCalm: Scenario = buildShipScenario(
  "ship-descent-calm",
  "Ship Descent — Calm",
  "calm",
);

export const ShipDescentStandard: Scenario = buildShipScenario(
  "ship-descent-standard",
  "Ship Descent — Standard",
  "standard",
);

export const ShipDescentStormy: Scenario = buildShipScenario(
  "ship-descent-stormy",
  "Ship Descent — Stormy",
  "stormy",
);

export const SCENARIOS: readonly Scenario[] = [
  BoosterDescentCalm,
  BoosterDescentStandard,
  BoosterDescentStormy,
  ShipDescentCalm,
  ShipDescentStandard,
  ShipDescentStormy,
];

/**
 * Look up a scenario by id, returning a FRESHLY BUILT instance. Freshness
 * matters: stormy scenarios carry stateful Dryden wind, and a shared
 * instance would leak gust-PRNG state between runs (frozen gusts,
 * order-dependent Monte-Carlo results — SLS-48). The exported singleton
 * constants remain for static data access (ICs, envelopes) but sim runs
 * should always go through this function.
 */
export function scenarioById(id: string): Scenario | undefined {
  switch (id) {
    case "booster-descent-calm":
      return buildScenario(id, "Booster Descent — Calm", "calm", calmWind);
    case "booster-descent-standard":
      return buildScenario(
        id,
        "Booster Descent — Standard",
        "standard",
        standardWind,
      );
    case "booster-descent-stormy":
      return buildScenario(id, "Booster Descent — Stormy", "stormy", stormyWind);
    case "ship-descent-calm":
      return buildShipScenario(id, "Ship Descent — Calm", "calm");
    case "ship-descent-standard":
      return buildShipScenario(id, "Ship Descent — Standard", "standard");
    case "ship-descent-stormy":
      return buildShipScenario(id, "Ship Descent — Stormy", "stormy");
    default:
      return undefined;
  }
}

/**
 * Legacy convenience used by tests + the default sim store; returns the
 * canonical Standard variant. Behaves identically to
 * `BoosterDescentStandard` — kept so older imports keep working without
 * touching every call site.
 */
export function boosterDescentScenario(): Scenario {
  return BoosterDescentStandard;
}
