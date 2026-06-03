/**
 * Initial-condition scenarios — paired (vehicle, world) bundles you can
 * load into the simulator. v1 ships one bootstrap scenario so `R` (reset)
 * in the runner has something concrete to reset to; a richer scenario
 * library is a later ticket.
 */

import type { SurfaceState } from "./aero.js";
import { BoosterFins } from "./presets/booster-fins.js";
import {
  consumeFuel,
  currentInertia,
  currentMass,
  full,
  tankCapacity,
} from "./mass.js";
import { SuperHeavyMass } from "./presets/super-heavy.js";
import { SuperHeavyEngines } from "./presets/super-heavy-engines.js";
import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";
import { createRigidBody } from "./state.js";
import type { EngineState } from "./thrust.js";
import { initialEngineState } from "./thrust.js";
import type { EngineGroup } from "./control.js";
import { defineVehicle, type Vehicle, type World } from "./world.js";

export type Scenario = {
  readonly name: string;
  readonly vehicle: Vehicle;
  readonly initialWorld: World;
};

// Booster engine grouping mirrors the SuperHeavyEngines layout:
// 3 centre + 10 inner + 20 outer = 33 Raptors. Only centre gimbals.
const boosterEngineGroupOf: readonly EngineGroup[] = [
  ...Array<EngineGroup>(3).fill("centre"),
  ...Array<EngineGroup>(10).fill("inner"),
  ...Array<EngineGroup>(20).fill("outer"),
];

/** Cylinder cross-section of the booster (9 m outer diameter). */
const BOOSTER_REF_AREA = Math.PI * 4.5 * 4.5;
const BOOSTER_CD = 0.7;

export const BoosterVehicle: Vehicle = defineVehicle({
  engines: SuperHeavyEngines,
  engineGroupOf: boosterEngineGroupOf,
  surfaces: BoosterFins,
  bodyRefArea: BOOSTER_REF_AREA,
  bodyCd: BOOSTER_CD,
});

/**
 * Bootstrap scenario: the Super Heavy booster ~800 m above the pad in a
 * pure descent, propellant ≈30 % remaining, engines unlit. Use Space to
 * unpause the runner, `F`/`X` per the keymap to actually fly.
 */
export function boosterDescentScenario(): Scenario {
  const initialMass = consumeFuel(
    full(SuperHeavyMass),
    0.7 * tankCapacity(SuperHeavyMass),
  );
  const rigidBody = createRigidBody({
    mass: currentMass(initialMass),
    inertia: currentInertia(initialMass),
    position: Vec3.of(0, 800, 0),
    velocity: Vec3.of(0, -20, 0),
    attitude: Quat.IDENTITY,
    angularVelocity: Vec3.ZERO,
  });
  const engineStates: readonly EngineState[] = SuperHeavyEngines.map(() =>
    initialEngineState(),
  );
  const surfaceStates: readonly SurfaceState[] = BoosterFins.map(() => ({
    deflection: 0,
  }));
  const initialWorld: World = {
    rigidBody,
    mass: initialMass,
    engineStates,
    surfaceStates,
    t: 0,
  };
  return {
    name: "booster-descent",
    vehicle: BoosterVehicle,
    initialWorld,
  };
}
