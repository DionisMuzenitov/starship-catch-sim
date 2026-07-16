/**
 * Assembly layouts for build-tower-glb.mjs (SLS-76).
 *
 * Coordinates are the STL's native **Z-up millimetre** print frame: +Z is the
 * tower's vertical axis, parts centred on their own print origin. The builder
 * measures the assembled bbox, then rotates Z-up→Y-up and scales the whole
 * thing to TOWER_HEIGHT_M, so these numbers only need to be self-consistent
 * (relative stacking), not real-world.
 *
 * `parts[]` entries:
 *   file        path relative to --kit
 *   node        node/name prefix
 *   translate   [x,y,z] mm offset in the assembly frame
 *   rotate      [rx,ry,rz] degrees (intrinsic X→Y→Z), optional
 *   count       instances (default 1)
 *   pitch       [x,y,z] mm added per instance (stacking), optional
 *   articulated true → emitted as its own named node for the loader to rotate
 *
 * Measured part heights (mm), MikeNotBrick "Launch tower" group:
 *   BaseBottom z[-13..32]  BaseTop z[2..76]      → base section spans -13..76
 *   MainSegmentBottom z[0..85]  MainSegmentTop z[75..137] → one module 0..137
 *   TopSegmentBottom z[0..57]   TopSegmentTop z[47..69]   → top section 0..69
 * Sheet quantities: Base ×1, Main Segment ×7, Top Segment ×1.
 */

import {
  ARM_HINGE_OFFSET_X_M,
  ARM_HINGE_OFFSET_Z_M,
  DEFAULT_ARM_HEIGHT_M,
} from "../../packages/physics/src/index.js";

const BASE_TOP_Z = 76; // where the first main module sits on the base
const MAIN_PITCH = 137; // main-module height (Bottom+Top span)
const MAIN_COUNT = 7;
const TOP_Z = BASE_TOP_Z + MAIN_PITCH * MAIN_COUNT; // top segment sits above the stack

const MB = "Launch tower";

export const LAYOUTS = {
  // Pass 1: tower column only (validate parse/stack/orient/scale).
  mikenotbrick: {
    heightFraction: 1, // full assembled lattice → TOWER_HEIGHT_M
    parts: [
      // base (two interlocking halves, shared frame)
      { file: `${MB}/BaseBottom.stl`, node: "Base" },
      { file: `${MB}/BaseTop.stl`, node: "Base" },
      // 7 stacked main modules (each = bottom + top half in a shared 0..137 frame)
      { file: `${MB}/MainSegmentBottom.stl`, node: "Main", count: MAIN_COUNT, translate: [0, 0, BASE_TOP_Z], pitch: [0, 0, MAIN_PITCH] },
      { file: `${MB}/MainSegmentTop.stl`, node: "Main", count: MAIN_COUNT, translate: [0, 0, BASE_TOP_Z], pitch: [0, 0, MAIN_PITCH] },
      // top cap
      { file: `${MB}/TopSegmentBottom.stl`, node: "Top", translate: [0, 0, TOP_Z] },
      { file: `${MB}/TopSegmentTop.stl`, node: "Top", translate: [0, 0, TOP_Z] },
    ],
    // Carriage: the frame that clamps the chopsticks to the tower and rides it
    // up/down. Rendered in the arm group so it moves with the chopstick assembly.
    //
    // Measured native frame (both parts share it): +z up (posts z[-95..-40],
    // A-frame cable hub at z[0..8] top), y = width (hook cavities at ±[44..55]
    // wrap the tower's 92 mm-apart face corner columns), +x = depth going BACK
    // over the tower (front plate at x=0, CarriageBottom's rear boom to x=158).
    // CarriageTop is the 24 mm front layer; CarriageBottom sandwiches behind it.
    carriage: {
      files: [
        { file: "Chopsticks/CarriageTop.stl", xOff: 0 },
        { file: "Chopsticks/CarriageBottom.stl", xOff: 24 },
      ],
      heightM: DEFAULT_ARM_HEIGHT_M,
      // native z that must land at the arm-hinge height: arm pin (arm z≈-66)
      // seats in the post tops (carriage z≈-40) → carriage z = arm z + 21.
      zPinNative: 21,
      // world X (east, before group yaw) of the native x=0 front plate: tower
      // face half-width (46 mm) + column half-depth so the hooks wrap the
      // east-face corner columns.
      frontPlateXM: 6.2,
    },
    // Chopstick arms, world-anchored at the physics hinges (catch side = +X).
    worldArms: [
      {
        file: "Chopsticks/Chopstick.stl",
        hinge: [ARM_HINGE_OFFSET_X_M, DEFAULT_ARM_HEIGHT_M, ARM_HINGE_OFFSET_Z_M],
        vertZeroNative: 0, // native z at the hinge pin
        // Measured native frame: tip at y=0, tail + descending skid pyramid at
        // y[200..245], and the PIVOT = the hollow vertical hinge tube running
        // the arm's full height at the tail's inner corner, centre
        // (x=-34.5, y=240) — the part mounts 180° about that tube: tip → +X
        // (east), tail tucks along the tower, and open/close swings about the
        // real attachment axis. The right arm is the left's MIRROR image
        // (without it both sides render as left arms).
        pivotNative: [-34.5, 240],
        // Placement anchor: the native point that sits AT the physics hinge
        // (owner-approved arm placement). The node origin (rotation axis) is
        // then offset to the pivot tube's world position — moving the AXIS to
        // the arm, not the arm to the axis.
        anchorNative: [-3, 200],
        sides: [
          { name: "LeftChopstick", sign: -1 },
          { name: "RightChopstick", sign: 1, mirror: true },
        ],
      },
    ],
  },
};
