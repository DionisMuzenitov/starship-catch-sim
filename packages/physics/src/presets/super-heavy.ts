/**
 * Super Heavy booster — mass-properties preset.
 *
 * All figures are **approximate** public estimates and should be treated as
 * gameplay constants, not engineering ground truth. Sources vary; we pick a
 * defensible internally-consistent set rather than chasing the latest leak.
 *
 * Refs (browse 2026-05):
 * - SpaceX Starship vehicle page (linked figures, Block 2 era).
 * - Wikipedia: "SpaceX Super Heavy" — mass, dimensions, propellant capacity.
 * - Elon Musk presentation slides (2024) — quoted propellant load ~3,400 t.
 *
 * Body frame:
 * - Origin at the engine plane (bottom).
 * - +Y up the long axis.
 * - Tank centred on the Y axis (x = z = 0).
 */

import { Mat3 } from "../math/mat3.js";
import { Vec3 } from "../math/vec3.js";
import type { MassProperties } from "../mass.js";

const dryMass = 200_000; // kg — approximate, Block 2 estimate
const height = 71; // m — overall length of the booster
const radius = 4.5; // m — 9 m outer diameter

// Tank geometry — most of the booster is propellant tankage.
const tankBottom = 5; // m — leaves room for engine section
const tankTop = 67; // m — leaves room for interstage section
const tankRadius = radius;
const propellantDensity = 830; // kg/m³ — densified CH4+LOX mix, rough average

// Dry CoM heuristic: the engine section is heavy and low; the rest of the
// dry mass is distributed along the tank walls. We estimate dry CoM about
// 28 m up — biased low compared to geometric centre (~35 m).
const dryCoM = Vec3.of(0, 28, 0);

// Dry inertia about dryCoM: model the dry structure as a thin rod of mass
// `dryMass` and length `height`, plus a thin shell for the cylinder. For a
// thin rod of length L about its CoM perpendicular to its axis: I = mL²/12.
// We use rod-perpendicular for I_xx = I_zz, and a small thin-shell value
// (m·r²) for I_yy.
const Ixx = (dryMass * height * height) / 12;
const Iyy = dryMass * radius * radius;
const dryInertia: Mat3 = Mat3.of(Ixx, 0, 0, 0, Iyy, 0, 0, 0, Ixx);

export const SuperHeavyMass: MassProperties = {
  dryMass,
  propellantMass: 0, // call full(SuperHeavyMass) to load propellant
  dryCoM,
  dryInertia,
  tankBottom,
  tankTop,
  tankRadius,
  propellantDensity,
};
