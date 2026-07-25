/**
 * Engine plume VFX (SLS-60) — the live-sim wrapper. Owns one `InstancedMesh`
 * of alpha-blended cones (a single draw call, no per-particle CPU) and, each
 * frame, writes the per-instance matrices/colours from the live sim world via
 * the shared `updatePlumeInstances` core. The rendering/tuning lives in
 * `plumeInstances.ts` so the `/sandbox/plumes` lab drives the exact same flame.
 *
 * **No anchor of its own (SLS-88 / SLS-91).** This mesh is a CHILD of the
 * vehicle body group in `BoosterFlight`, which owns the whole-body transform
 * (position + attitude) and drives it imperatively in `useFrame`. So the plumes
 * inherit exactly the pose the model is drawn at — one anchor, zero drift, at
 * any sim speed — and this component only writes body-frame instances (mount +
 * gimbal + throttle-scaled cone). It reads the store imperatively (like the
 * camera rig) so it never triggers a React re-render.
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
  BOOSTER_PLUME_ALIGN,
  MAX_PLUMES,
  MODELLED_BOOSTER_PLUMES,
  SHIP_PLUME_ALIGN,
  makePlumeGeometry,
  makePlumeMaterial,
  updatePlumeInstances,
} from "./plumeInstances";

type Props = {
  /** Booster vs ship — decided ONCE by the parent (`BoosterFlight`) from the
   *  same world the model is chosen from, so the plume set can never disagree
   *  with the drawn vehicle. Per-frame throttle/gimbal still come from the live
   *  store read below. */
  readonly isShip: boolean;
};

export function EnginePlumes({ isShip }: Props) {
  const meshRef = useRef<InstancedMesh>(null);

  const geometry = useMemo(makePlumeGeometry, []);
  const material = useMemo(makePlumeMaterial, []);

  const engines = isShip ? StarshipEngines : SuperHeavyEngines;
  const plumeCount = isShip ? StarshipEngines.length : MODELLED_BOOSTER_PLUMES;
  // Alignment is per-vehicle — the ship's nozzles aren't the booster's.
  const align = isShip ? SHIP_PLUME_ALIGN : BOOSTER_PLUME_ALIGN;

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const { rigidBody: rb, engineStates, t } = useSimStore.getState().world;

    // Instances only — the parent body group already carries the world anchor
    // (position + attitude). Mounts are physics metres, in body frame, matching
    // the group origin at the engine plane.
    updatePlumeInstances(mesh, {
      engines,
      engineStates,
      plumeCount,
      altitudeM: rb.position.y,
      t,
      mountScale: align.mountScale,
      centerOffset: align.centerOffset,
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
