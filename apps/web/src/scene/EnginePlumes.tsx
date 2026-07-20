/**
 * Engine plume VFX (SLS-60) — the live-sim wrapper. Owns one `InstancedMesh`
 * of additive cones (a single draw call, no per-particle CPU) and, each frame,
 * reads the sim world imperatively (like `CollisionDebug` / the camera rigs, so
 * the plumes never trigger a React re-render) and hands it to the shared
 * `updatePlumeInstances` core. The rendering/tuning lives in `plumeInstances.ts`
 * so the `/sandbox/plumes` lab drives the exact same flame.
 */

import { useMemo, useRef } from "react";

import { useFrame } from "@react-three/fiber";
import {
  SuperHeavyEngines,
  StarshipEngines,
} from "@starship-catch-sim/physics";
import { type InstancedMesh } from "three";

import { useSimStore } from "../state/simStore.js";

import {
  MAX_PLUMES,
  MODELLED_BOOSTER_PLUMES,
  makePlumeGeometry,
  makePlumeMaterial,
  updatePlumeInstances,
} from "./plumeInstances";

export function EnginePlumes() {
  const meshRef = useRef<InstancedMesh>(null);

  const geometry = useMemo(makePlumeGeometry, []);
  const material = useMemo(makePlumeMaterial, []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const world = useSimStore.getState().world;
    const { rigidBody: rb, engineStates, t } = world;
    const isShip = engineStates.length === StarshipEngines.length;
    const engines = isShip ? StarshipEngines : SuperHeavyEngines;
    const plumeCount = isShip
      ? StarshipEngines.length
      : MODELLED_BOOSTER_PLUMES;

    // Body frame: place the instanced mesh at the engine plane
    // (rigidBody.position) with the body attitude; instance matrices are then
    // pure body-frame. Mounts are already physics metres — no model rescale.
    mesh.position.set(rb.position.x, rb.position.y, rb.position.z);
    mesh.quaternion.set(rb.attitude.x, rb.attitude.y, rb.attitude.z, rb.attitude.w);

    updatePlumeInstances(mesh, {
      engines,
      engineStates,
      plumeCount,
      altitudeM: rb.position.y,
      t,
    });
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_PLUMES]}
      frustumCulled={false}
      // Draw after the camera-centred Sky (which sorts as the nearest
      // transparent and would otherwise paint over the plumes against open
      // sky); depthTest still lets the opaque booster occlude them.
      renderOrder={2}
    />
  );
}
