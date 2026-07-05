/**
 * Extract one vehicle's subtree from the loaded stack GLB (SLS-44).
 *
 * The Sketchfab export wraps everything under `Sketchfab_model` (scale 5 +
 * an up-axis rotation) and `GLTF_SceneRootNode`. Those ancestors carry the
 * model's real scale/orientation. Reparenting a bare subtree drops them —
 * the vehicle then renders at 1/5 size and mis-oriented. So we clone the
 * subtree and BAKE its parent's world matrix into the clone, reconstructing
 * the normalization in isolation. Measured world-normalized quantities
 * (engine-plane Y, fin height, MODEL_SCALE) are all in this post-bake frame.
 */

import type { Object3D } from "three";

import { sanitizeName } from "./assetTransform";

export function extractVehicleRoot(
  scene: Object3D,
  rawRootName: string,
): Object3D {
  scene.updateWorldMatrix(true, true);
  const src = scene.getObjectByName(sanitizeName(rawRootName));
  if (!src) throw new Error(`GLB missing subtree ${rawRootName}`);
  const root = src.clone(true);
  if (src.parent) root.applyMatrix4(src.parent.matrixWorld);
  return root;
}
