/**
 * Super Heavy booster — engine layout preset.
 *
 * 33 Raptors arranged in three concentric rings: 3 centre, 10 inner, 20
 * outer. Only the centre 3 gimbal; the rest are fixed.
 *
 * Note on count: the SLS-10 ticket prompt described "3-13-20" but that sums
 * to 36; the actual Super Heavy (Block 2 era) has 33 engines in a 3-10-20
 * arrangement. Going with the real layout.
 *
 * All numbers are approximate; gameplay constants.
 *
 * Body frame matches `presets/super-heavy.ts`:
 * - origin at the engine plane
 * - +y up the long axis
 * - x/z form the engine-plane disk
 */

import { Vec3 } from "../math/vec3.js";
import type { Engine } from "../thrust.js";

import { RaptorSeaParams } from "./raptor.js";

const Y = 0; // engines mounted at the engine plane (body origin)
const DOWN = Vec3.of(0, -1, 0);

const CENTRE_RADIUS = 0.6; // m — small ring of 3 centre engines
const INNER_RADIUS = 1.8; // m
const OUTER_RADIUS = 3.6; // m

const ringMounts = (count: number, radius: number, phaseDeg = 0): Vec3[] => {
  const mounts: Vec3[] = [];
  const phase = (phaseDeg * Math.PI) / 180;
  for (let i = 0; i < count; i++) {
    const angle = phase + (2 * Math.PI * i) / count;
    mounts.push(Vec3.of(radius * Math.cos(angle), Y, radius * Math.sin(angle)));
  }
  return mounts;
};

const centreEngines: Engine[] = ringMounts(3, CENTRE_RADIUS).map((mount) => ({
  ...RaptorSeaParams,
  mount,
  direction: DOWN,
  canGimbal: true,
}));

const innerEngines: Engine[] = ringMounts(10, INNER_RADIUS).map((mount) => ({
  ...RaptorSeaParams,
  mount,
  direction: DOWN,
  canGimbal: false,
  maxGimbal: 0,
  maxGimbalRate: 0,
  tauGimbal: 0,
}));

const outerEngines: Engine[] = ringMounts(20, OUTER_RADIUS, 9).map((mount) => ({
  ...RaptorSeaParams,
  mount,
  direction: DOWN,
  canGimbal: false,
  maxGimbal: 0,
  maxGimbalRate: 0,
  tauGimbal: 0,
}));

export const SuperHeavyEngines: readonly Engine[] = [
  ...centreEngines,
  ...innerEngines,
  ...outerEngines,
];
