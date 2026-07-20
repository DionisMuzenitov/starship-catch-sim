/**
 * Store-independent core of the engine-plume VFX (SLS-60). The geometry +
 * material factories and the per-frame instance update live here so BOTH the
 * live sim (`<EnginePlumes>`, store-driven) and the isolated
 * `/sandbox/plumes` lab (slider-driven) render the exact same flame — you tune
 * it in the lab and the sim inherits it unchanged.
 *
 * The caller owns the `InstancedMesh`'s world transform (body position +
 * attitude); this module only writes the per-instance matrices + colours in
 * BODY frame (mount + gimbal + throttle-scaled cone).
 */

import type { Engine, EngineState } from "@starship-catch-sim/physics";
import {
  Color,
  ConeGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  type InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";

import { MODEL_SCALE } from "../models/glb/assetTransform";

import {
  plumeDims,
  plumeFlicker,
  plumeIntensity,
  seaLevelFactor,
} from "./enginePlumeMath";

/**
 * Only the engines with a modelled nozzle bell get a plume, so a flame never
 * hangs in empty space. `BoosterModelGLB` models 13 booster Raptors (centre 3
 * + inner 10; its `ENGINE_NODES`) — the outer 20 aren't modelled, and firing
 * them is an ascent-phase thing, not the catch. The ship models all 6. 13 is
 * the max, so it sizes the instance buffer.
 */
export const MODELLED_BOOSTER_PLUMES = 13;
export const MAX_PLUMES = MODELLED_BOOSTER_PLUMES;

// Flame colour gradient from nozzle (t=0) to tip (t=1): yellow-white core →
// golden yellow → orange → dark red. Brightness is kept modest (see
// enginePlumeMath) so the palette shows through as fire instead of clamping to
// a white cone (owner feedback).
const CORE = new Color(1.0, 0.95, 0.55);
const HOT = new Color(1.0, 0.8, 0.3);
const MID = new Color(1.0, 0.5, 0.12);
const TIP = new Color(0.25, 0.06, 0.0);

function gradientColor(t: number, out: Color): Color {
  if (t < 0.25) return out.copy(CORE).lerp(HOT, t / 0.25);
  if (t < 0.55) return out.copy(HOT).lerp(MID, (t - 0.25) / 0.3);
  return out.copy(MID).lerp(TIP, (t - 0.55) / 0.45);
}

/** Unit cone pointing down −Y (apex at the nozzle y=0, base at y=−1), with the
 *  flame gradient + an opacity ramp baked into RGBA vertex colours. Scaled
 *  per-instance to (radius, length, radius). Open-ended: no base cap to draw. */
export function makePlumeGeometry(): ConeGeometry {
  const geo = new ConeGeometry(1, 1, 12, 1, true);
  geo.translate(0, -0.5, 0); // apex → y=0, base → y=−1
  const pos = geo.getAttribute("position");
  // RGBA: colour gradient + alpha that's opaque at the nozzle and fades to
  // transparent at the tip. Alpha (not additive blending) is what makes the
  // flame visible against a BRIGHT sky as well as dark space — additive can
  // only add light, so it washes out to nothing over a bright background.
  const colors = new Float32Array(pos.count * 4);
  const c = new Color();
  for (let v = 0; v < pos.count; v++) {
    const t = -pos.getY(v); // y ∈ [−1,0] → t ∈ [0,1]
    gradientColor(t, c);
    colors[v * 4] = c.r;
    colors[v * 4 + 1] = c.g;
    colors[v * 4 + 2] = c.b;
    colors[v * 4 + 3] = Math.max(0, 1 - t); // opaque nozzle → transparent tip
  }
  geo.setAttribute("color", new Float32BufferAttribute(colors, 4));
  return geo;
}

export function makePlumeMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    vertexColors: true, // RGBA (alpha comes from the geometry colour attribute)
    transparent: true,
    depthWrite: false,
    side: DoubleSide, // visible from any angle, incl. looking up the cone
    toneMapped: false, // keep the HDR core >1 so it still blooms through PostFX
  });
}

/** Inputs for one frame of plume instances, in body frame. */
export type PlumeFrame = {
  /** Static engine layout (mounts) — booster or ship. */
  readonly engines: readonly Engine[];
  /** Live per-engine throttle / gimbal / on. */
  readonly engineStates: readonly EngineState[];
  /** How many leading engines have a modelled bell (see `MAX_PLUMES`). */
  readonly plumeCount: number;
  /** Body-frame altitude (≈ MSL) selecting the sea-level↔vacuum regime. */
  readonly altitudeM: number;
  /** Time (s) for the flicker phase. */
  readonly t: number;
  /** Multiplier on the engine mount radius so the plumes land on the DRAWN
   *  nozzle ring. Defaults to `MODEL_SCALE`; the `/sandbox/plumes` lab exposes
   *  it as a slider so the ring can be dialled to the GLB. */
  readonly mountScale?: number;
};

// Per-frame scratch — never allocate inside the update loop.
const _mat = new Matrix4();
const _posV = new Vector3();
const _quat = new Quaternion();
const _eul = new Euler();
const _scaleV = new Vector3();
const _col = new Color();
const _white = new Color(1, 1, 1);

/**
 * Write the per-instance matrices + colours for one frame. The mesh must have
 * capacity `MAX_PLUMES`; unused / off engines collapse to a zero-scale point.
 */
export function updatePlumeInstances(mesh: InstancedMesh, f: PlumeFrame): void {
  const sea = seaLevelFactor(f.altitudeM);
  const mountScale = f.mountScale ?? MODEL_SCALE;
  for (let i = 0; i < MAX_PLUMES; i++) {
    const st = i < f.plumeCount ? f.engineStates[i] : undefined;
    const dims = st ? plumeDims(plumeIntensity(st), sea) : null;
    if (!st || !dims || dims.length <= 0) {
      _mat.makeScale(0, 0, 0); // collapse to a point → invisible
      mesh.setMatrixAt(i, _mat);
      mesh.setColorAt(i, _col.setRGB(0, 0, 0)); // scratch — never mutate _white
      continue;
    }
    // Anchor at the DRAWN nozzle: the GLB body is rendered scaled by
    // MODEL_SCALE, so the visible engine ring sits at mount × MODEL_SCALE.
    // (Physics mounts are metric, but the plume is a visual overlay on the
    // scaled model — it must match the model, not the physics frame.)
    const m = f.engines[i].mount;
    _posV.set(m.x * mountScale, m.y * mountScale, m.z * mountScale);
    _eul.set(st.gimbalPitch, 0, st.gimbalYaw, "XYZ");
    _quat.setFromEuler(_eul);
    _scaleV.set(dims.radius, dims.length, dims.radius);
    _mat.compose(_posV, _quat, _scaleV);
    mesh.setMatrixAt(i, _mat);
    const b = dims.brightness * plumeFlicker(f.t, i);
    mesh.setColorAt(i, _col.copy(_white).multiplyScalar(b));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
