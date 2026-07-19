/**
 * Pure yaw/pitch ↔ direction math for the first-person camera (SLS-58).
 *
 * Convention: yaw rotates around world +Y (yaw 0 looks toward −Z, the default
 * camera forward), pitch tilts up/down. `forwardFromYawPitch` and
 * `yawPitchFromDir` are exact inverses (up to normalisation), so seeding
 * yaw/pitch from a look direction and rebuilding the forward vector is stable.
 */

export type Vec3Lit = { x: number; y: number; z: number };
export type YawPitch = { yaw: number; pitch: number };

/** Look no further than ~85° up/down so the view never flips over the poles. */
export const MAX_PITCH = (85 * Math.PI) / 180;

export function forwardFromYawPitch(yaw: number, pitch: number): Vec3Lit {
  const cp = Math.cos(pitch);
  return { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Screen-right vector (horizontal) for a given yaw. */
export function rightFromYaw(yaw: number): Vec3Lit {
  return { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };
}

export function yawPitchFromDir(x: number, y: number, z: number): YawPitch {
  const len = Math.hypot(x, y, z) || 1;
  return {
    yaw: Math.atan2(x, -z),
    pitch: Math.asin(Math.max(-1, Math.min(1, y / len))),
  };
}

export function clampPitch(p: number): number {
  return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p));
}
