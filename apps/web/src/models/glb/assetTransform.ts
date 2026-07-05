/**
 * Model→physics-frame mapping for the clarence365 GLB (SLS-44 / ADR-012).
 *
 * The sourced model is ~1:1 with metres and stacks the two vehicles:
 * measured world bounds (matrix chain composed) —
 *   Superheavy V4: y ∈ [−3.01, 63.36], grid-fin pivots at y≈60.78,
 *                  engine plane at y≈0.08
 *   Starship V4:   y ∈ [63.26, 110.68]  (sits atop the booster)
 * Grid fins sit at physics Y_MOUNT=65 m and the model has them at
 * y≈60.78 → scale = 65 / 60.78 ≈ 1.069. The same scale maps the ship
 * body (model 47.4 → 50.7 ≈ physics BODY_HEIGHT 50).
 *
 * Each loader renders ONLY its vehicle's subtree, re-anchored so the
 * engine plane is at y=0 (the physics body-frame origin).
 */

/** Metres per model unit (grid-fin height anchor). */
export const MODEL_SCALE = 1.069;

/** Model-space Y of each vehicle's engine plane (physics origin). */
export const BOOSTER_ENGINE_PLANE_Y = 0.08;
export const SHIP_ENGINE_PLANE_Y = 63.26;

/** Subtree node names in the GLB. */
export const BOOSTER_ROOT = "Superheavy V4_37";
export const SHIP_ROOT = "Starship V4_19";

/**
 * The scaled Y offset that moves a vehicle's engine plane to the frame
 * origin. Applied on the inner (scaled) group: `y' = (y − plane)·scale`.
 */
export function enginePlaneOffsetY(enginePlaneModelY: number): number {
  return -enginePlaneModelY * MODEL_SCALE;
}

/** Azimuth (rad, atan2(z,x)) of a part from its model-space pivot. Used
 *  to match the model's diagonal-mounted grid fins (±x,±z) to the
 *  physics fin order and to derive each fin's radial hinge axis. */
export function azimuthOf(pivotX: number, pivotZ: number): number {
  return Math.atan2(pivotZ, pivotX);
}

/**
 * three's GLTFLoader rewrites node names through
 * `PropertyBinding.sanitizeNodeName` — whitespace → `_`, and the reserved
 * chars `[ ] . : /` are stripped. So the GLB's `"Superheavy V4_37"` and
 * `"Gridfin.001_21"` load as `"Superheavy_V4_37"` and `"Gridfin001_21"`.
 * Look parts up by the sanitized name, not the raw glTF name (SLS-44).
 */
export function sanitizeName(name: string): string {
  return name.replace(/\s/g, "_").replace(/[[\].:/]/g, "");
}
