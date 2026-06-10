export { Vec3 } from "./math/vec3.js";
export { Quat } from "./math/quat.js";
export { Mat3 } from "./math/mat3.js";
export { createRigidBody } from "./state.js";
export type { RigidBodyState, RigidBodyInit } from "./state.js";
export { step } from "./integrator.js";
export {
  consumeFuel,
  currentCoM,
  currentInertia,
  currentMass,
  full,
  tankCapacity,
} from "./mass.js";
export type { MassProperties } from "./mass.js";
export { SuperHeavyMass } from "./presets/super-heavy.js";
export { StarshipMass } from "./presets/starship.js";
export {
  aggregate,
  engineForceTorque,
  initialEngineState,
  updateEngineState,
  G0,
} from "./thrust.js";
export type {
  Engine,
  EngineCommand,
  EngineContribution,
  EngineState,
  PlantOutput,
} from "./thrust.js";
export { SuperHeavyEngines } from "./presets/super-heavy-engines.js";
export { StarshipEngines } from "./presets/starship-engines.js";
export {
  densityAt,
  pressureAt,
  pressureRatio,
  RHO0,
  P0,
  H_RHO,
  H_P,
} from "./atmosphere.js";
export { bodyDragForce } from "./drag.js";
export {
  initialSurfaceState,
  surfaceForceTorque,
  updateSurface,
} from "./aero.js";
export type {
  Surface,
  SurfaceContribution,
  SurfaceKind,
  SurfaceState,
} from "./aero.js";
export { BoosterFins } from "./presets/booster-fins.js";
export { ShipFlaps } from "./presets/ship-flaps.js";
export {
  constantWind,
  drydenTurbulence,
  layeredWind,
} from "./wind.js";
export type { DrydenOpts, WindField, WindLayer } from "./wind.js";
export { neutralControl } from "./control.js";
export type { ControlInput, EngineGroup, EngineGroupBag } from "./control.js";
export { createWorld, defineVehicle, simStep, DEFAULT_ENV } from "./world.js";
export type { SimEnv, Vehicle, World } from "./world.js";
export {
  BoosterDescentCalm,
  BoosterDescentStandard,
  BoosterDescentStormy,
  BoosterVehicle,
  SCENARIOS,
  boosterDescentScenario,
  evaluateCatch,
  scenarioById,
} from "./scenarios.js";
export type {
  CatchEnvelope,
  Scenario,
  ScenarioDifficulty,
  SuccessVerdict,
} from "./scenarios.js";
