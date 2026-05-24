/**
 * Starship upper-stage engine layout preset.
 *
 * 3 sea-level Raptors (gimballed) clustered at the centre, plus 3 vacuum
 * Raptors (fixed) arranged on a wider ring, offset 60° from the SL trio.
 *
 * Numbers are approximate; gameplay constants.
 *
 * Body frame matches `presets/starship.ts`:
 * - origin at the bottom of the stage
 * - +y up the long axis
 */

import { Vec3 } from "../math/vec3.js";
import type { Engine } from "../thrust.js";

import { RaptorSeaParams, RaptorVacParams } from "./raptor.js";

const Y = 0;
// Force direction on the body when the engine fires — see `thrust.ts` docs.
const UP = Vec3.of(0, 1, 0);

const SL_RADIUS = 1.0; // m — tight cluster
const VAC_RADIUS = 2.8; // m — wider ring on the perimeter

const ringMounts = (count: number, radius: number, phaseDeg = 0): Vec3[] => {
  const mounts: Vec3[] = [];
  const phase = (phaseDeg * Math.PI) / 180;
  for (let i = 0; i < count; i++) {
    const angle = phase + (2 * Math.PI * i) / count;
    mounts.push(Vec3.of(radius * Math.cos(angle), Y, radius * Math.sin(angle)));
  }
  return mounts;
};

const seaLevel: Engine[] = ringMounts(3, SL_RADIUS).map((mount) => ({
  ...RaptorSeaParams,
  mount,
  direction: UP,
  canGimbal: true,
}));

const vacuum: Engine[] = ringMounts(3, VAC_RADIUS, 60).map((mount) => ({
  ...RaptorVacParams,
  mount,
  direction: UP,
  canGimbal: false,
}));

export const StarshipEngines: readonly Engine[] = [...seaLevel, ...vacuum];
