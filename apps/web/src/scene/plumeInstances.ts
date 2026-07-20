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
  AdditiveBlending,
  Color,
  ConeGeometry,
  Euler,
  Float32BufferAttribute,
  type InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";

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

// Flame colour gradient from nozzle (t=0) to tip (t=1): pale blue-white core →
// white-hot → orange → dark. Under additive blending "dark" reads as
// transparent, so the plume fades out at its tip with no alpha channel.
const CORE = new Color(0.75, 0.88, 1.0);
const HOT = new Color(1.0, 0.95, 0.85);
const MID = new Color(1.0, 0.5, 0.15);
const TIP = new Color(0.05, 0.01, 0.0);

function gradientColor(t: number, out: Color): Color {
  if (t < 0.25) return out.copy(CORE).lerp(HOT, t / 0.25);
  if (t < 0.55) return out.copy(HOT).lerp(MID, (t - 0.25) / 0.3);
  return out.copy(MID).lerp(TIP, (t - 0.55) / 0.45);
}

/** Unit cone pointing down −Y (apex at the nozzle y=0, base at y=−1), with the
 *  flame gradient baked into vertex colours. Scaled per-instance to
 *  (radius, length, radius). Open-ended: no base cap to draw. */
export function makePlumeGeometry(): ConeGeometry {
  const geo = new ConeGeometry(1, 1, 12, 1, true);
  geo.translate(0, -0.5, 0); // apex → y=0, base → y=−1
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let v = 0; v < pos.count; v++) {
    gradientColor(-pos.getY(v), c); // y ∈ [−1,0] → t ∈ [0,1]
    colors[v * 3] = c.r;
    colors[v * 3 + 1] = c.g;
    colors[v * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geo;
}

export function makePlumeMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false, // keep HDR core >1 so it blooms
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
  for (let i = 0; i < MAX_PLUMES; i++) {
    const st = i < f.plumeCount ? f.engineStates[i] : undefined;
    const dims = st ? plumeDims(plumeIntensity(st), sea) : null;
    if (!st || !dims || dims.length <= 0) {
      _mat.makeScale(0, 0, 0); // collapse to a point → invisible
      mesh.setMatrixAt(i, _mat);
      mesh.setColorAt(i, _col.setRGB(0, 0, 0)); // scratch — never mutate _white
      continue;
    }
    const m = f.engines[i].mount;
    _posV.set(m.x, m.y, m.z);
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
