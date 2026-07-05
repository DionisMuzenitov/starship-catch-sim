/**
 * Ship loader (SLS-44 / ADR-012). Renders the clarence365 GLB's
 * `Starship V4` subtree with the same props as the procedural
 * StarshipModel. Articulation: the four flaps deflect about their
 * tangential hinge, the six Raptors (3 sea-level + 3 vacuum) gimbal.
 */

import { useLayoutEffect, useMemo, useRef } from "react";

import {
  StarshipEngines,
  ShipFlaps,
  type EngineState,
  type Quat,
  type SurfaceState,
  type Vec3,
} from "@starship-catch-sim/physics";
import { Euler, Group, Object3D, Quaternion, Vector3 } from "three";

import {
  MODEL_SCALE,
  SHIP_ENGINE_PLANE_Y,
  SHIP_ROOT,
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

const FLAP_NODES = [
  "Foward Flap_5",
  "Foward Flap.001_6",
  "Aft Flaps_2",
  "Aft Flaps.001_3",
];

const ENGINE_NODES = [
  "Raptor 2 Engine_13",
  "Raptor 2 Engine.001_14",
  "Raptor 2 Engine.002_15",
  "Raptor 2 Vaccum Engine_16",
  "Raptor 2 Vaccum Engine.001_17",
  "Raptor 2 Vaccum Engine.002_18",
];

type FlapRig = { node: Object3D; q0: Quaternion; axis: Vector3; az: number };
type EngRig = { node: Object3D; q0: Quaternion };

export function StarshipModelGLB({
  position,
  attitude,
  engineStates,
  surfaceStates,
}: Props) {
  const scene = useStackScene();
  const outerRef = useRef<Group>(null);

  const { root, flaps, engines } = useMemo(() => {
    const root = extractVehicleRoot(scene, SHIP_ROOT);

    const flapRigs: FlapRig[] = [];
    for (const name of FLAP_NODES) {
      const node = root.getObjectByName(sanitizeName(name));
      if (!node) continue;
      const p = node.position;
      // Flaps hinge about the body-tangential axis (⊥ radial, horizontal):
      // (−z, 0, x). Deflection pitches the flap out into the airflow.
      const axis = new Vector3(-p.z, 0, p.x).normalize();
      flapRigs.push({
        node,
        q0: node.quaternion.clone(),
        axis,
        az: azimuthOf(p.x, p.z),
      });
    }
    flapRigs.sort((a, b) => a.az - b.az);

    const engRigs: EngRig[] = [];
    for (const name of ENGINE_NODES) {
      const node = root.getObjectByName(sanitizeName(name));
      if (!node) continue;
      engRigs.push({ node, q0: node.quaternion.clone() });
    }
    return { root, flaps: flapRigs, engines: engRigs };
  }, [scene]);

  useLayoutEffect(() => {
    outerRef.current?.quaternion.set(
      attitude.x,
      attitude.y,
      attitude.z,
      attitude.w,
    );
  }, [attitude]);

  useLayoutEffect(() => {
    const order = ShipFlaps.map((f, i) => ({
      i,
      az: Math.atan2(f.mount.z, f.mount.x),
    })).sort((a, b) => a.az - b.az);
    const dq = new Quaternion();
    flaps.forEach((flap, rank) => {
      const physIdx = order[rank]?.i ?? rank;
      const defl = surfaceStates[physIdx]?.deflection ?? 0;
      dq.setFromAxisAngle(flap.axis, defl);
      flap.node.quaternion.copy(flap.q0).premultiply(dq);
    });
  }, [flaps, surfaceStates]);

  useLayoutEffect(() => {
    const dq = new Quaternion();
    const euler = new Euler();
    engines.forEach((eng, i) => {
      const st = engineStates[i];
      if (!st) return;
      euler.set(st.gimbalPitch, 0, st.gimbalYaw, "XYZ");
      dq.setFromEuler(euler);
      eng.node.quaternion.copy(eng.q0).premultiply(dq);
    });
  }, [engines, engineStates]);

  if (engineStates.length !== StarshipEngines.length) {
    throw new Error(
      `StarshipModelGLB: expected ${StarshipEngines.length} engine states, got ${engineStates.length}`,
    );
  }
  if (surfaceStates.length !== ShipFlaps.length) {
    throw new Error(
      `StarshipModelGLB: expected ${ShipFlaps.length} surface states, got ${surfaceStates.length}`,
    );
  }

  return (
    <group ref={outerRef} position={[position.x, position.y, position.z]}>
      <group
        scale={MODEL_SCALE}
        position={[0, enginePlaneOffsetY(SHIP_ENGINE_PLANE_Y), 0]}
      >
        <primitive object={root} />
      </group>
    </group>
  );
}
