/**
 * Booster loader (SLS-44 / ADR-012). Renders the clarence365 GLB's
 * `Superheavy V4` subtree in place of the procedural BoosterModel, with
 * the SAME props so the caller is unchanged. Whole-body position+attitude
 * plus articulation: grid-fin deflection about each fin's radial hinge,
 * and centre/inner Raptor gimbal — driven by the named nodes' matrices
 * (their origins sit at the mounts, so rotating them pivots correctly).
 */

import { useLayoutEffect, useMemo, useRef } from "react";

import {
  BoosterFins,
  SuperHeavyEngines,
  type EngineState,
  type Quat,
  type SurfaceState,
  type Vec3,
} from "@starship-catch-sim/physics";
import { Euler, Group, Object3D, Quaternion, Vector3 } from "three";

import {
  BOOSTER_ENGINE_PLANE_Y,
  BOOSTER_ROOT,
  MODEL_SCALE,
  azimuthOf,
  enginePlaneOffsetY,
  sanitizeName,
} from "./assetTransform";
import { extractVehicleRoot } from "./extract";
import { useStackScene } from "./stackAsset";

type Props = {
  position: Vec3;
  attitude: Quat;
  engineStates: readonly EngineState[];
  surfaceStates: readonly SurfaceState[];
  altitudeFactor?: number;
};

const FIN_NODES = [
  "Gridfin_20",
  "Gridfin.001_21",
  "Gridfin.002_22",
  "Gridfin.003_23",
];

/** The 13 modelled booster Raptors (centre 3 + inner 10). Physics
 *  `SuperHeavyEngines` lists 33 (3+10+20); the outer 20 aren't modelled,
 *  so the first 13 states (centre+inner) drive these nodes. */
const ENGINE_NODES = Array.from(
  { length: 13 },
  (_, i) => `Raptor 2 Engine.${String(i + 3).padStart(3, "0")}_${i + 24}`,
);

type FinRig = { node: Object3D; q0: Quaternion; axis: Vector3; az: number };
type EngRig = { node: Object3D; q0: Quaternion };

export function BoosterModelGLB({
  position,
  attitude,
  engineStates,
  surfaceStates,
}: Props) {
  const scene = useStackScene();
  const outerRef = useRef<Group>(null);

  const { root, fins, engines } = useMemo(() => {
    const root = extractVehicleRoot(scene, BOOSTER_ROOT);

    // Grid fins: capture rest pose + radial hinge axis (model-space
    // direction of the fin's mount), sorted by azimuth so we can pair
    // them with the physics fin order deterministically.
    const finRigs: FinRig[] = [];
    for (const name of FIN_NODES) {
      const node = root.getObjectByName(sanitizeName(name));
      if (!node) continue;
      const p = node.position;
      const az = azimuthOf(p.x, p.z);
      const axis = new Vector3(p.x, 0, p.z).normalize();
      finRigs.push({ node, q0: node.quaternion.clone(), axis, az });
    }
    finRigs.sort((a, b) => a.az - b.az);

    const engRigs: EngRig[] = [];
    for (const name of ENGINE_NODES) {
      const node = root.getObjectByName(sanitizeName(name));
      if (!node) continue;
      engRigs.push({ node, q0: node.quaternion.clone() });
    }
    return { root, fins: finRigs, engines: engRigs };
  }, [scene]);

  useLayoutEffect(() => {
    outerRef.current?.quaternion.set(
      attitude.x,
      attitude.y,
      attitude.z,
      attitude.w,
    );
  }, [attitude]);

  // Grid-fin deflection: rotate about the radial hinge axis (parent frame)
  // on top of the rest pose. Physics fins sorted by azimuth pair with the
  // model fins sorted by azimuth (both ascending).
  useLayoutEffect(() => {
    const order = BoosterFins.map((f, i) => ({
      i,
      az: Math.atan2(f.mount.z, f.mount.x),
    })).sort((a, b) => a.az - b.az);
    const dq = new Quaternion();
    fins.forEach((fin, rank) => {
      const physIdx = order[rank]?.i ?? rank;
      const defl = surfaceStates[physIdx]?.deflection ?? 0;
      dq.setFromAxisAngle(fin.axis, defl);
      fin.node.quaternion.copy(fin.q0).premultiply(dq);
    });
  }, [fins, surfaceStates]);

  // Engine gimbal: pitch about body X, yaw about body Z, on top of rest.
  useLayoutEffect(() => {
    const dq = new Quaternion();
    const euler = new Euler();
    engines.forEach((eng, i) => {
      const st = engineStates[i];
      if (!st) return;
      // Gimbal: pitch about body X, yaw about body Z (parent frame).
      euler.set(st.gimbalPitch, 0, st.gimbalYaw, "XYZ");
      dq.setFromEuler(euler);
      eng.node.quaternion.copy(eng.q0).premultiply(dq);
    });
  }, [engines, engineStates]);

  if (engineStates.length !== SuperHeavyEngines.length) {
    throw new Error(
      `BoosterModelGLB: expected ${SuperHeavyEngines.length} engine states, got ${engineStates.length}`,
    );
  }
  if (surfaceStates.length !== BoosterFins.length) {
    throw new Error(
      `BoosterModelGLB: expected ${BoosterFins.length} surface states, got ${surfaceStates.length}`,
    );
  }

  return (
    <group ref={outerRef} position={[position.x, position.y, position.z]}>
      <group
        scale={MODEL_SCALE}
        position={[0, enginePlaneOffsetY(BOOSTER_ENGINE_PLANE_Y), 0]}
      >
        <primitive object={root} />
      </group>
    </group>
  );
}
