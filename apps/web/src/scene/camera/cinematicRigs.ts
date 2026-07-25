/**
 * Cinematic camera — a moving **auto-director** for the `M` (movie) mode
 * (SLS-59). Returns the camera pose for a given booster world + a REAL-time
 * clock; `CameraRig` applies it directly each frame (`camera = boosterPos +
 * offset`), so — like the chase cam's delta-follow — the booster is glued to
 * frame with ZERO lag at any sim speed (1× … 8×). All the motion lives in the
 * offset, which evolves on the real-time clock, so the cinematic move stays
 * smooth no matter how fast the sim runs.
 *
 * ## The moves (grounded in standard cinematography)
 *
 *  - **Arc / orbit** — a continuous slow circle around the booster (`GLOBAL_ORBIT`
 *    deg/s) gives the shot constant energy and reveals every side.
 *  - **Crane / boom + dolly** — high up, a crane bias lifts the camera ABOVE the
 *    booster looking down so the GROUND is in frame (an establishing opening),
 *    easing to the shots' own angles as it nears the tower. A sequence of shots
 *    then changes elevation + distance to reveal different things: a high 3/4 of
 *    the whole vehicle, low looking up at the ENGINES + plumes, a level PROFILE
 *    of the grid fins, and a push-in for detail. Shots cross-fade (`smoothstep`)
 *    into the NEXT near the end of each window, so it drifts between angles.
 *  - **The catch** — once the booster is CLOSE to the cradle, a cut to a fixed
 *    dramatic tower vantage it descends INTO; `lookAt` tracks the booster (biased
 *    to its upper body) directly, so it stays framed with no lag and holds as the
 *    post-catch beauty shot.
 *
 * Pure over `(world, tReal)` → unit-testable; the shot numbers are the knobs.
 */

import { Vec3, type World } from "@starship-catch-sim/physics";
import { MathUtils } from "three";

import type { CameraTarget } from "./modes";

/** Fixed money-shot vantage beside the chopsticks (world frame), and how far
 *  ABOVE the booster CoM to aim (compose on the upper body / nose as it settles
 *  into the cradle — owner: focus on the top, not the bottom). */
const CATCH_CAM = Vec3.of(75, 140, 48);
const CATCH_LOOK_UP_M = 40;
/** Engage the fixed money shot only once the booster is this close to the cradle
 *  (m altitude). Above this the orbit tracks it down: a fixed cam aimed at a
 *  booster ~1 km up would point near-straight-up at a distant speck, so the cut
 *  waits until the booster is near enough to frame WITH the cradle. Exported so
 *  `CameraRig` can latch on it (hysteresis against altitude bounce). */
export const CATCH_CAM_ALT_M = 220;

/** One descent shot: a vantage on the booster in spherical terms.
 *  `azOffDeg` is added to the continuous global orbit; `elevDeg` is the angle
 *  above the horizon (negative = below, looking up); `dist` is metres from the
 *  booster; `lookBiasY` raises the look point above the CoM so the body is
 *  composed in frame rather than dead-centred. */
type Shot = {
  readonly azOffDeg: number;
  readonly elevDeg: number;
  readonly dist: number;
  readonly lookBiasY: number;
};

// SHOTS[0] is the OPENING — a wide high 3/4 of the whole vehicle (craned further
// above by the altitude bias at entry, so it establishes the height + ground).
const SHOTS: readonly Shot[] = [
  { azOffDeg: -90, elevDeg: 30, dist: 140, lookBiasY: 0 }, //  high 3/4 — whole vehicle (opening)
  { azOffDeg: 150, elevDeg: -20, dist: 135, lookBiasY: 16 }, // low — engines + plumes
  { azOffDeg: 40, elevDeg: 6, dist: 165, lookBiasY: 6 }, //     side profile — grid fins
  { azOffDeg: 210, elevDeg: 12, dist: 95, lookBiasY: 10 }, //   dolly-in — detail
];
const SHOT_DUR_S = 7; // real seconds per shot
const TRANSITION_S = 1.8; // cross-fade into the next shot at the end of the window
const GLOBAL_ORBIT_DEG_S = 5; // continuous arc
/** Global multiplier on every shot distance — pulls the camera back for a wider,
 *  more comfortable frame (owner-tuned). Scales the whole set at once. */
const DISTANCE_SCALE = 1.7;

/** Crane-above bias (deg) added to every shot's elevation, ramped by altitude:
 *  high up the camera rides ABOVE the booster looking DOWN so the ground is in
 *  frame (an establishing, "look how high we are" beginning), easing to the
 *  shots' own low/side angles as it nears the tower (owner: add above angles at
 *  the start so the watcher sees the ground). */
const HIGH_ALT_M = 40_000;
const LOW_ALT_M = 3_000;
const HIGH_ELEV_BIAS_DEG = 42;
function craneBiasDeg(altM: number): number {
  const f = MathUtils.clamp((altM - LOW_ALT_M) / (HIGH_ALT_M - LOW_ALT_M), 0, 1);
  return HIGH_ELEV_BIAS_DEG * f;
}

/** Interpolate degrees along the SHORTEST arc (so a shot change never whips the
 *  long way round the circle). */
function lerpAngleDeg(a: number, b: number, t: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}

/** Blend the active shot with the NEXT one over the last `TRANSITION_S` of its
 *  window, so a shot holds and then drifts into the next (and `tReal = 0` opens
 *  cleanly on `SHOTS[0]` rather than the wrap-around previous shot). */
function blendedShot(tReal: number): Shot {
  const n = SHOTS.length;
  const windowIdx = Math.floor(tReal / SHOT_DUR_S);
  const idx = ((windowIdx % n) + n) % n;
  const cur = SHOTS[idx]!;
  const next = SHOTS[(idx + 1) % n]!;
  const localT = tReal - windowIdx * SHOT_DUR_S;
  const k = MathUtils.smoothstep(localT, SHOT_DUR_S - TRANSITION_S, SHOT_DUR_S);
  return {
    azOffDeg: lerpAngleDeg(cur.azOffDeg, next.azOffDeg, k),
    elevDeg: MathUtils.lerp(cur.elevDeg, next.elevDeg, k),
    dist: MathUtils.lerp(cur.dist, next.dist, k),
    lookBiasY: MathUtils.lerp(cur.lookBiasY, next.lookBiasY, k),
  };
}

/** Camera offset from the booster for a spherical (azimuth, elevation, dist). */
function sphericalOffset(azRad: number, elevRad: number, dist: number): Vec3 {
  const c = Math.cos(elevRad);
  return Vec3.of(
    dist * c * Math.sin(azRad),
    dist * Math.sin(elevRad),
    dist * c * Math.cos(azRad),
  );
}

/**
 * Cinematic camera pose for the booster world at real-clock time `tReal` (s).
 * The descent orbits/cranes around the booster; once it is within
 * `CATCH_CAM_ALT_M` (or `forceCatch` latches it — see `CameraRig`, which keeps
 * the money shot from strobing if the altitude bounces back over the boundary)
 * it cuts to the fixed tower money shot. `CameraRig` sets `camera.position` to
 * this directly (no damping) so the follow has zero lag at any sim speed.
 */
export function cinematicView(
  world: World,
  tReal: number,
  forceCatch = false,
): CameraTarget {
  const r = world.rigidBody.position;

  if (forceCatch || r.y < CATCH_CAM_ALT_M) {
    return {
      position: CATCH_CAM,
      lookAt: Vec3.of(r.x, r.y + CATCH_LOOK_UP_M, r.z),
    };
  }

  const s = blendedShot(tReal);
  const az = MathUtils.degToRad(GLOBAL_ORBIT_DEG_S * tReal + s.azOffDeg);
  const elev = MathUtils.degToRad(s.elevDeg + craneBiasDeg(r.y));
  const offset = sphericalOffset(az, elev, s.dist * DISTANCE_SCALE);
  return {
    position: Vec3.add(r, offset),
    lookAt: Vec3.of(r.x, r.y + s.lookBiasY, r.z),
  };
}

export const __forTests = {
  CATCH_CAM,
  CATCH_CAM_ALT_M,
};
