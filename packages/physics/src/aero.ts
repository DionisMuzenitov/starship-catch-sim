/**
 * Aerodynamic control surfaces — grid fins (booster) and articulated flaps
 * (Starship). Both kinds use the same simple flat-plate aero model:
 *
 *   - Local airflow at the surface mount is the body's translational
 *     velocity plus the rotational contribution ω × r, then transformed
 *     into the body frame so we can reason in body-fixed axes.
 *   - The surface normal pivots about its hinge axis by the current
 *     deflection.
 *   - Angle of attack `α` is the signed angle between the airflow direction
 *     and the surface plane, with `sin(α) = n · ŵind`. Clamped at
 *     `alphaStall` for the lift coefficient.
 *   - `Cl = Cl_alpha · α`, `Cd = Cd0 + k · α²` (`k = 1` for v1).
 *   - Lift acts perpendicular to the airflow in the plane spanned by airflow
 *     and surface normal. Drag acts along the airflow.
 *
 * This is intentionally simple: linear-Cl with stall, no Mach effects, no
 * panel-to-panel interaction, no flow separation modelling. Enough for
 * believable behaviour and an interesting controls problem.
 */

import { Quat } from "./math/quat.js";
import { Vec3 } from "./math/vec3.js";

export type SurfaceKind = "grid_fin" | "flap";

export type Surface = {
  readonly kind: SurfaceKind;
  /** Attachment point in body frame (m). */
  readonly mount: Vec3;
  /** Unit vector in body frame: axis the surface pivots about. */
  readonly hingeAxisBody: Vec3;
  /** Unit vector in body frame: surface normal when `deflection = 0`. */
  readonly zeroDeflectionNormalBody: Vec3;
  /** Surface area (m²). */
  readonly area: number;
  /** Lift slope (per radian). */
  readonly clAlpha: number;
  /** Zero-lift drag coefficient. */
  readonly cd0: number;
  /** Maximum deflection magnitude (rad). */
  readonly maxDeflection: number;
  /** Maximum deflection slew rate (rad/s). */
  readonly maxDeflectionRate: number;
  /** Stall angle (rad). Beyond this, `Cl` is clamped. */
  readonly alphaStall: number;
  /** First-order lag time constant on deflection (s). */
  readonly tau: number;
};

export type SurfaceState = {
  /** Realised deflection (rad). */
  readonly deflection: number;
};

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

function lagFirstOrder(
  current: number,
  target: number,
  tau: number,
  dt: number,
): number {
  if (tau <= 0) return target;
  const alpha = 1 - Math.exp(-dt / tau);
  return current + (target - current) * alpha;
}

/** Advance one surface's deflection toward `target`, with lag + slew limit. */
export function updateSurface(
  s: Surface,
  st: SurfaceState,
  target: number,
  dt: number,
): SurfaceState {
  const clamped = clamp(target, -s.maxDeflection, s.maxDeflection);
  const desired = lagFirstOrder(st.deflection, clamped, s.tau, dt);
  const maxStep = s.maxDeflectionRate * dt;
  const delta = clamp(desired - st.deflection, -maxStep, maxStep);
  return { deflection: st.deflection + delta };
}

export type SurfaceContribution = {
  /** Aerodynamic force on the body in body frame (N). */
  readonly forceBody: Vec3;
  /** Moment about the body's CoM in body frame (N·m). */
  readonly torqueBody: Vec3;
};

const ZERO_CONTRIBUTION: SurfaceContribution = Object.freeze({
  forceBody: Vec3.ZERO,
  torqueBody: Vec3.ZERO,
});

/**
 * Aero force + torque produced by one surface, given:
 * - `vWorld`: world-frame translational velocity of the body's CoM (m/s)
 * - `omegaBody`: angular velocity in body frame (rad/s)
 * - `attitude`: body→world rotation
 * - `comBody`: current centre-of-mass in body frame (m)
 * - `density`: local air density (kg/m³)
 */
export function surfaceForceTorque(
  s: Surface,
  st: SurfaceState,
  vWorld: Vec3,
  omegaBody: Vec3,
  attitude: Quat,
  comBody: Vec3,
  density: number,
): SurfaceContribution {
  if (density < 1e-12) return ZERO_CONTRIBUTION;

  // 1. Local velocity of the surface mount, in body frame.
  //    v_mount_world = v_world + R(q) · (ω × r_body)
  //    v_mount_body  = R(q)⁻¹ · v_mount_world = R(q)⁻¹·v_world + ω × r_body
  const armBody = Vec3.sub(s.mount, comBody);
  const rotContribBody = Vec3.cross(omegaBody, armBody);
  const vWorldInBody = Quat.rotateVec3(Quat.conjugate(attitude), vWorld);
  const vMountBody = Vec3.add(vWorldInBody, rotContribBody);

  const speed = Vec3.length(vMountBody);
  if (speed < 1e-9) return ZERO_CONTRIBUTION;

  // 2. Wind direction at the surface (air flows opposite the body's motion).
  const windDir = Vec3.scale(vMountBody, -1 / speed);

  // 3. Current surface normal: rotate the zero-deflection normal about the
  //    hinge axis by the realised deflection.
  const qDefl = Quat.fromAxisAngle(s.hingeAxisBody, st.deflection);
  const n = Quat.rotateVec3(qDefl, s.zeroDeflectionNormalBody);

  // 4. Angle of attack: signed angle between the airflow direction and the
  //    surface plane. sin(α) = dot(n, windDir).
  const sinAlpha = clamp(Vec3.dot(n, windDir), -1, 1);
  const alpha = Math.asin(sinAlpha);

  // 5. Lift coefficient with stall clamp.
  const alphaForCl = clamp(alpha, -s.alphaStall, s.alphaStall);
  const cl = s.clAlpha * alphaForCl;

  // 6. Drag coefficient: parasitic + induced. k = 1 is a rough placeholder
  //    that gives ~Cl-comparable induced drag near stall.
  const cd = s.cd0 + 1 * alpha * alpha;

  // 7. Dynamic pressure.
  const q = 0.5 * density * speed * speed;
  const liftMag = q * s.area * cl;
  const dragMag = q * s.area * cd;

  // 8. Lift direction: component of `n` perpendicular to the wind, then
  //    unit-normalised. If `n` is parallel to wind (α = ±π/2), there is no
  //    well-defined lift plane → lift falls out naturally because |n_perp| → 0.
  const nPerp = Vec3.sub(n, Vec3.scale(windDir, Vec3.dot(n, windDir)));
  const nPerpLen = Vec3.length(nPerp);
  const liftVec =
    nPerpLen > 1e-9
      ? Vec3.scale(nPerp, liftMag / nPerpLen)
      : Vec3.ZERO;

  // 9. Drag direction: along the airflow (pushes the body downwind).
  const dragVec = Vec3.scale(windDir, dragMag);

  const forceBody = Vec3.add(liftVec, dragVec);
  const torqueBody = Vec3.cross(armBody, forceBody);

  return { forceBody, torqueBody };
}

/** Initial surface state — neutral deflection. */
export function initialSurfaceState(): SurfaceState {
  return { deflection: 0 };
}
