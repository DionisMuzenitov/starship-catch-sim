/**
 * Starship upper stage — mass-properties preset.
 *
 * Approximate public estimates; see notes on super-heavy.ts for caveats.
 *
 * Refs (browse 2026-05):
 * - SpaceX Starship vehicle page (Block 2 era).
 * - Wikipedia: "SpaceX Starship (spacecraft)" — dry mass, dimensions.
 * - Various conference talks quoting ~1,200 t propellant capacity.
 *
 * Body frame matches super-heavy.ts: origin at the stage bottom, +Y up.
 */

import { Mat3 } from "../math/mat3.js";
import { Vec3 } from "../math/vec3.js";
import type { MassProperties } from "../mass.js";

const dryMass = 120_000; // kg — approximate, Block 2 estimate (no payload)
const height = 50; // m — overall length of the upper stage
const radius = 4.5; // m — 9 m outer diameter (matches Super Heavy)

// Tank geometry — Starship has a payload bay above and engine section
// below the propellant tanks. Tank spans roughly the middle 25 m.
const tankBottom = 3; // m
const tankTop = 28; // m
const tankRadius = radius;
const propellantDensity = 830; // kg/m³ — densified CH4+LOX mix, rough average

// Dry CoM: heavier sections (engines + payload bay) bracket the tank, with
// the engine section being heavier. Approximate dry CoM about 20 m up.
const dryCoM = Vec3.of(0, 20, 0);

// Dry inertia: same rod + thin shell approximation as Super Heavy.
const Ixx = (dryMass * height * height) / 12;
const Iyy = dryMass * radius * radius;
const dryInertia: Mat3 = Mat3.of(Ixx, 0, 0, 0, Iyy, 0, 0, 0, Ixx);

export const StarshipMass: MassProperties = {
  dryMass,
  propellantMass: 0, // call full(StarshipMass) to load propellant
  dryCoM,
  dryInertia,
  tankBottom,
  tankTop,
  tankRadius,
  propellantDensity,
};
