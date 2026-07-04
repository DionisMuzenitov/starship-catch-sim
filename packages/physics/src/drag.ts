/**
 * Body drag — quadratic, isotropic, Mach-dependent Cd (SLS-45). One drag
 * coefficient regardless of angle of attack; the vehicle's `bodyCd` is the
 * SUBSONIC plateau value and `cdAt` scales it with Mach number. AoA-dependent
 * and belly-flop aero remain in the aero-surfaces layer (SLS-12).
 *
 * Drag uses velocity relative to wind (the caller passes rel-vel since
 * SLS-13).
 */

import { densityAt, machNumber } from "./atmosphere.js";
import { Vec3 } from "./math/vec3.js";

// ---------------------------------------------------------------------------
// Cd(M) — normalized multiplier curve on the subsonic plateau.
//
// Shape for a RETROGRADE blunt booster (engines-first, grid fins deployed):
// drag divergence starts early (~M 0.6), a broad peak near M 1.5, then only
// mild supersonic decay to an asymptote well above the plateau — unlike the
// sharp M≈1.1 spike-and-decay of a slender ascending rocket. Anchored to
// DLR SALTO/CALLISTO trisonic wind-tunnel data; see
// docs/reference/dynamics.md for the sources and rationale.
// Interpolation between breakpoints is smoothstep — C1 at every join.
// ---------------------------------------------------------------------------

/** [Mach, Cd multiplier on the subsonic plateau] — must be Mach-ascending. */
const CD_MACH_TABLE: readonly (readonly [number, number])[] = [
  [0.0, 1.0],
  [0.6, 1.0], // drag-divergence onset (SALTO already rising at M 0.6)
  [0.9, 1.25],
  [1.1, 1.55],
  [1.5, 1.8], // broad transonic/low-supersonic peak (CALLISTO location)
  [2.0, 1.78], // SALTO M 2.0 anchor
  [3.0, 1.6], // SALTO M 3.0 anchor
  [5.0, 1.5], // high-Mach asymptote, held constant beyond
];

/** Cubic smoothstep in [0, 1]. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Mach-dependent drag coefficient. `cdSubsonic` is the vehicle's plateau
 * value (e.g. 0.7 for the booster); the return value is that plateau scaled
 * by the Cd(M) multiplier curve. Below the drag-divergence Mach the output
 * equals `cdSubsonic` exactly, so subsonic behaviour is unchanged from the
 * constant-Cd model.
 */
export function cdAt(mach: number, cdSubsonic: number): number {
  const m = Math.max(0, mach);
  const table = CD_MACH_TABLE;
  const last = table[table.length - 1]!;
  if (m >= last[0]) return cdSubsonic * last[1];
  let lo = table[0]!;
  let hi = table[1]!;
  for (let i = 1; i < table.length; i++) {
    hi = table[i]!;
    if (hi[0] > m) break;
    lo = hi;
  }
  if (hi[0] === lo[0]) return cdSubsonic * lo[1];
  const t = smoothstep((m - lo[0]) / (hi[0] - lo[0]));
  return cdSubsonic * (lo[1] + (hi[1] - lo[1]) * t);
}

/**
 * Force on the body due to aerodynamic drag, in **world frame** (newtons).
 *
 *   F_drag = − ½ · ρ(h) · |v| · v · Cd(M) · A
 *
 * The minus sign and the factor of `v` (rather than its unit vector) give a
 * vector that opposes velocity with magnitude `½ ρ v² Cd A`. `cdSubsonic`
 * is the vehicle's subsonic plateau Cd; the effective Cd rises through the
 * transonic regime per `cdAt`.
 *
 * Attitude is not consumed — see the file header on isotropic Cd.
 */
export function bodyDragForce(
  velocityWorld: Vec3,
  altitudeM: number,
  refAreaM2: number,
  cdSubsonic: number,
): Vec3 {
  const speed = Vec3.length(velocityWorld);
  if (speed === 0) return Vec3.ZERO;
  const rho = densityAt(altitudeM);
  const cd = cdAt(machNumber(speed, altitudeM), cdSubsonic);
  // Coefficient combines all scalars: − ½ · ρ · |v| · Cd · A. Then we
  // multiply by the *vector* v to keep the right direction.
  const coeff = -0.5 * rho * speed * cd * refAreaM2;
  return Vec3.scale(velocityWorld, coeff);
}
