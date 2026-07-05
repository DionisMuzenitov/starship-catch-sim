/**
 * Super Heavy booster grid fins — 4-fin layout for descent control.
 *
 * Geometry choice (body frame, +y up the rocket, body origin at engine
 * plane per super-heavy.ts):
 *
 *   - Fins mounted near the top of the booster on the body cylinder.
 *   - Four fins at body-frame angles 0°, 90°, 180°, 270° (i.e. +x, +z, -x, -z).
 *   - Each fin's `zeroDeflectionNormal` points outward radially (think of
 *     the fin face being perpendicular to the airflow when the booster is
 *     belly-flopping). Real grid fins are lattice structures so this is a
 *     coarse approximation; one flat panel with a respectable Cl_alpha
 *     captures the gross control authority.
 *   - Hinge axis is the local "vertical" tangent (parallel to body +y)
 *     so deflection pitches the fin forward/aft in the local horizontal.
 *
 * Numbers are approximate; gameplay constants.
 */

import { Vec3 } from "../math/vec3.js";
import type { Surface } from "../aero.js";

const Y_MOUNT = 65; // m — near the top of the booster
const R_BODY = 4.5; // m — outer radius
const FIN_AREA = 4.0; // m² — coarse grid-fin equivalent flat-panel area
const CL_ALPHA = 3.0; // /rad — flat-plate-ish, well below thin-airfoil 2π
const CD0 = 0.05;
const MAX_DEFL = 0.349; // ~20°
const MAX_DEFL_RATE = 0.5; // rad/s
const ALPHA_STALL = 0.436; // ~25°
const TAU = 0.05; // s — fast hydraulic gimbal

// SLS-49 geometry fix: real grid fins hinge about their RADIAL mounting
// strut and tilt into the axial airflow — that is where their control
// torque comes from. The previous model (hinge about body +Y, radial
// normal) was aerodynamically inert to deflection in axial flow: the
// normal stayed perpendicular to the airstream at every deflection, so
// controllers had zero fin authority and max-q aero torque overpowered
// the engine gimbal (measured: attitude runaway to ~85° mid-burn).
//
// Zero-deflection normal is TANGENTIAL (ŷ × r̂): the fin plane contains
// the body axis and the radial strut. Deflecting about the radial hinge
// tilts the normal toward ±body-Y, giving the axial flow an angle of
// attack and the fin a tangential lift force high above the CoM —
// pitch/yaw control torque, like the real vehicle.
const fin = (mountDirX: number, mountDirZ: number): Surface => ({
  kind: "grid_fin",
  mount: Vec3.of(mountDirX * R_BODY, Y_MOUNT, mountDirZ * R_BODY),
  hingeAxisBody: Vec3.of(mountDirX, 0, mountDirZ),
  // ŷ × r̂ = (0,1,0) × (mx,0,mz) = (mz, 0, −mx)
  zeroDeflectionNormalBody: Vec3.of(mountDirZ, 0, -mountDirX),
  area: FIN_AREA,
  clAlpha: CL_ALPHA,
  cd0: CD0,
  maxDeflection: MAX_DEFL,
  maxDeflectionRate: MAX_DEFL_RATE,
  alphaStall: ALPHA_STALL,
  tau: TAU,
});

export const BoosterFins: readonly Surface[] = [
  fin(1, 0), // +x
  fin(0, 1), // +z
  fin(-1, 0), // -x
  fin(0, -1), // -z
];
