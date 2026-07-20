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
  temperatureAt,
  speedOfSoundAt,
  machNumber,
  RHO0,
  P0,
  H_RHO,
  H_P,
  GAMMA_AIR,
  R_AIR,
  ISA_LAYERS,
} from "./atmosphere.js";
export { bodyDragForce, cdAt, CD_MACH_TABLE } from "./drag.js";
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
  BOOSTER_CAPSULE,
  SHIP_CAPSULE,
  SCENARIOS,
  ShipDescentCalm,
  ShipDescentStandard,
  ShipDescentStormy,
  ShipVehicle,
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
export { currentPhase } from "./phase.js";
export type { Phase } from "./phase.js";
export {
  ARM_ANGLE_OPEN_RAD,
  ARM_HEIGHT_MAX_M,
  ARM_HEIGHT_MIN_M,
  ARM_HINGE_OFFSET_X_M,
  ARM_HINGE_OFFSET_Z_M,
  ARM_LENGTH_M,
  CAPTURE_VOLUME_Y_HALF_M,
  DEFAULT_ARM_HEIGHT_M,
  DEFAULT_TOWER_STATE,
  HARDPOINT_AFT_OFFSET_M,
  HARDPOINT_FORE_OFFSET_M,
  MAX_ARM_REACH_M,
  TAU_ARM_HEIGHT_S,
  TAU_ARM_LATERAL_S,
  TAU_ARM_OPENING_S,
  TOWER_FOOTPRINT_M,
  TOWER_HEIGHT_M,
  chopstickCaptureVolume,
  chopstickCatchPoints,
  clampArmReach,
  pointInAabb,
  stepTowerState,
  towerStructureAabb,
} from "./tower.js";
export type {
  Aabb,
  BodyCapsule,
  CaptureVolume,
  TowerCommand,
  TowerState,
} from "./tower.js";
export { GROUND_Y_M, evaluateCatchOutcome } from "./catch.js";
export type {
  CatchOutcome,
  CatchOutcomeKind,
  SiteCollision,
  TerminalMetrics,
} from "./catch.js";
export {
  REPLAY_SCHEMA_VERSION,
  createRecorder,
  interpolateReplay,
  parseReplay,
  serializeReplay,
} from "./replay.js";
export type {
  Recorder,
  RecorderArgs,
  Replay,
  ReplayFrame,
  ReplayHeader,
} from "./replay.js";
