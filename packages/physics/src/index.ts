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
