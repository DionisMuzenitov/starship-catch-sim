/**
 * Body drag — quadratic, isotropic, single-Cd model. Intentionally simple:
 * one drag coefficient regardless of angle of attack, no Mach dependence,
 * no transitions. Real Starship aero is highly non-linear and lands in the
 * aero-surfaces ticket (SLS-12).
 *
 * No wind: drag uses the body's world-frame velocity directly. Wind support
 * comes in SLS-13.
 */

import { densityAt } from "./atmosphere.js";
import { Vec3 } from "./math/vec3.js";

/**
 * Force on the body due to aerodynamic drag, in **world frame** (newtons).
 *
 *   F_drag = − ½ · ρ(h) · |v| · v · Cd · A
 *
 * The minus sign and the factor of `v` (rather than its unit vector) give a
 * vector that opposes velocity with magnitude `½ ρ v² Cd A`.
 *
 * Attitude is not consumed — see the file header on isotropic Cd. The
 * argument exists in the ticket spec but adds no information at V1.
 */
export function bodyDragForce(
  velocityWorld: Vec3,
  altitudeM: number,
  refAreaM2: number,
  cd: number,
): Vec3 {
  const speed = Vec3.length(velocityWorld);
  if (speed === 0) return Vec3.ZERO;
  const rho = densityAt(altitudeM);
  // Coefficient combines all scalars: − ½ · ρ · |v| · Cd · A. Then we
  // multiply by the *vector* v to keep the right direction.
  const coeff = -0.5 * rho * speed * cd * refAreaM2;
  return Vec3.scale(velocityWorld, coeff);
}
