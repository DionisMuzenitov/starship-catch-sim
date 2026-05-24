/**
 * Starship articulated flaps — 2 forward + 2 aft.
 *
 * Geometry (body frame matches `presets/starship.ts`: origin at the bottom
 * of the stage, +y up):
 *
 *   - 2 forward flaps near the top (`y ≈ 45`), mounted on the ±x side.
 *     Hinge axis is body +y, so each flap swings around the local vertical.
 *     Zero-deflection normal points radially outward — when the ship is
 *     belly-flopping, this is roughly into the airflow.
 *   - 2 aft flaps near the bottom (`y ≈ 5`), mounted on the ±x side, same
 *     hinge axis and zero-deflection normal convention as the forward pair.
 *
 * The fore/aft pairs together let a controller pitch (open one set, close
 * the other) and roll (open opposite sides asymmetrically) the belly-flopping
 * stage.
 *
 * Numbers are approximate; gameplay constants.
 */

import { Vec3 } from "../math/vec3.js";
import type { Surface } from "../aero.js";

const R_BODY = 4.5;
const FWD_Y = 45;
const AFT_Y = 5;
const FLAP_AREA = 12; // m² — forward+aft flaps are larger than grid fins
const CL_ALPHA = 4.0; // /rad — articulated panel
const CD0 = 0.04;
const MAX_DEFL = 1.0; // ~57° — Starship flaps swing through a wide arc
const MAX_DEFL_RATE = 0.5;
const ALPHA_STALL = 0.436;
const TAU = 0.12;

const UP_AXIS = Vec3.of(0, 1, 0);

const flap = (
  position: "fwd" | "aft",
  side: 1 | -1,
): Surface => {
  const y = position === "fwd" ? FWD_Y : AFT_Y;
  return {
    kind: "flap",
    mount: Vec3.of(side * R_BODY, y, 0),
    hingeAxisBody: UP_AXIS,
    zeroDeflectionNormalBody: Vec3.of(side, 0, 0),
    area: FLAP_AREA,
    clAlpha: CL_ALPHA,
    cd0: CD0,
    maxDeflection: MAX_DEFL,
    maxDeflectionRate: MAX_DEFL_RATE,
    alphaStall: ALPHA_STALL,
    tau: TAU,
  };
};

export const ShipFlaps: readonly Surface[] = [
  flap("fwd", 1), // forward-left  (+x)
  flap("fwd", -1), // forward-right (-x)
  flap("aft", 1), // aft-left      (+x)
  flap("aft", -1), // aft-right     (-x)
];
