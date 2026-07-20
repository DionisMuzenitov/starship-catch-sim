/**
 * Engine plume VFX (SLS-60). One `InstancedMesh` of additive cones — a single
 * draw call for all engines, no per-particle CPU — hung off the nozzles and
 * driven each frame by the live `engineStates`:
 *  - length + width scale with throttle; the flame vanishes when the engine is
 *    off (a low coast burn still shows a small flame — the policy uses one).
 *  - each cone tilts with its engine's gimbal (same `Euler(pitch,0,yaw)` the
 *    nozzle nodes use in `BoosterModelGLB`).
 *  - the sea-level→vacuum regime widens + lengthens + dims the plume with
 *    altitude (SLS-60 research: confined bright plume low, free-expansion fan
 *    high).
 *
 * Reads the store imperatively inside `useFrame` (like `CollisionDebug` /
 * the camera rigs) so 33 plumes never trigger a React re-render. The additive
 * core exceeds luminance 1 so it blooms through `<PostFX>`.
 */

import { useMemo, useRef } from "react";

import { useFrame } from "@react-three/fiber";
import {
  SuperHeavyEngines,
  StarshipEngines,
} from "@starship-catch-sim/physics";
import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  Euler,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";

import { useSimStore } from "../state/simStore.js";

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
const MODELLED_BOOSTER_PLUMES = 13;
const MAX_PLUMES = MODELLED_BOOSTER_PLUMES;

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
function makePlumeGeometry(): ConeGeometry {
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

// Per-frame scratch — never allocate inside useFrame.
const _mat = new Matrix4();
const _posV = new Vector3();
const _quat = new Quaternion();
const _eul = new Euler();
const _scaleV = new Vector3();
const _col = new Color();
const _white = new Color(1, 1, 1);

export function EnginePlumes() {
  const meshRef = useRef<InstancedMesh>(null);

  const geometry = useMemo(makePlumeGeometry, []);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false, // keep HDR core >1 so it blooms
      }),
    [],
  );

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const world = useSimStore.getState().world;
    const { rigidBody: rb, engineStates, t } = world;
    const isShip = engineStates.length === StarshipEngines.length;
    const engines = isShip ? StarshipEngines : SuperHeavyEngines;
    // Plume only the engines with a modelled bell (see MAX_PLUMES) so a flame
    // never hangs detached below the skirt.
    const plumeCount = isShip
      ? StarshipEngines.length
      : MODELLED_BOOSTER_PLUMES;

    // Body frame: put the whole instanced mesh at the engine plane
    // (rigidBody.position) with the body attitude; instance matrices are then
    // pure body-frame (mount + gimbal + scale). Mounts are already physics
    // metres, matching rigidBody.position — no model-unit rescale.
    mesh.position.set(rb.position.x, rb.position.y, rb.position.z);
    mesh.quaternion.set(
      rb.attitude.x,
      rb.attitude.y,
      rb.attitude.z,
      rb.attitude.w,
    );

    const sea = seaLevelFactor(rb.position.y);

    for (let i = 0; i < MAX_PLUMES; i++) {
      const st = i < plumeCount ? engineStates[i] : undefined;
      const dims = st ? plumeDims(plumeIntensity(st), sea) : null;
      if (!st || !dims || dims.length <= 0) {
        _mat.makeScale(0, 0, 0); // collapse to a point → invisible
        mesh.setMatrixAt(i, _mat);
        mesh.setColorAt(i, _col.setRGB(0, 0, 0)); // scratch — never mutate _white
        continue;
      }
      const m = engines[i].mount;
      _posV.set(m.x, m.y, m.z);
      _eul.set(st.gimbalPitch, 0, st.gimbalYaw, "XYZ");
      _quat.setFromEuler(_eul);
      _scaleV.set(dims.radius, dims.length, dims.radius);
      _mat.compose(_posV, _quat, _scaleV);
      mesh.setMatrixAt(i, _mat);
      const b = dims.brightness * plumeFlicker(t, i);
      mesh.setColorAt(i, _col.copy(_white).multiplyScalar(b));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_PLUMES]}
      frustumCulled={false}
    />
  );
}
