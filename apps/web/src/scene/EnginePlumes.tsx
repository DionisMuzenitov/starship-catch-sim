/**
 * Engine plume VFX (SLS-60) — the live-sim wrapper. Owns one `InstancedMesh`
 * of additive cones (a single draw call, no per-particle CPU) and hands the
 * live sim world to the shared `updatePlumeInstances` core. The rendering/
 * tuning lives in `plumeInstances.ts` so the `/sandbox/plumes` lab drives the
 * exact same flame.
 *
 * **Subscription-driven, NOT imperative (SLS-88).** SLS-60 originally read the
 * world via `getState()` inside `useFrame` to avoid re-renders. But the drawn
 * booster (`BoosterFlight`/`BoosterModelGLB`) applies its whole-body transform
 * through the React commit path (`position` prop + `attitude` in a layout
 * effect) off the *subscribed* store, while `useFrame` reads whatever the
 * runner last wrote — up to one runner-step newer. Per-step displacement scales
 * with the sim speed, so at 8× the plume anchor visibly led the model. Reading
 * the SAME committed `world` on the SAME commit (via a subscription, mirroring
 * `BoosterFlight`) keeps the anchor and the model matrix byte-identical every
 * painted frame — glued at 1×, 8×, and paused. Cost: one cheap extra reconcile
 * per frame (a single `<instancedMesh>` element); the heavy instance write runs
 * once per frame either way.
 */

import { useLayoutEffect, useMemo, useRef } from "react";

import {
  SuperHeavyEngines,
  StarshipEngines,
} from "@starship-catch-sim/physics";
import { type InstancedMesh } from "three";

import { isShipWorld } from "../models/glb";
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

export function EnginePlumes() {
  const meshRef = useRef<InstancedMesh>(null);

  const geometry = useMemo(makePlumeGeometry, []);
  const material = useMemo(makePlumeMaterial, []);

  // Subscribe to the SAME `world` slice the model draws from, so the plume
  // anchor is committed on the exact React pass that positions the booster.
  const world = useSimStore((s) => s.world);
  const { rigidBody: rb, engineStates, t } = world;
  const isShip = isShipWorld(world);
  const engines = isShip ? StarshipEngines : SuperHeavyEngines;
  const plumeCount = isShip ? StarshipEngines.length : MODELLED_BOOSTER_PLUMES;
  // Alignment is per-vehicle — the ship's nozzles aren't the booster's.
  const align = isShip ? SHIP_PLUME_ALIGN : BOOSTER_PLUME_ALIGN;

  // Anchor (attitude) + instance shapes applied in the layout phase, in
  // lockstep with the model's own whole-body `useLayoutEffect`. Body position
  // rides the `position` prop below (same as `BoosterModelGLB`'s outer group);
  // mounts are already physics metres, so the plume sits at the model's OUTER
  // transform with no `MODEL_SCALE`.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.quaternion.set(rb.attitude.x, rb.attitude.y, rb.attitude.z, rb.attitude.w);
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
      position={[rb.position.x, rb.position.y, rb.position.z]}
      frustumCulled={false}
      // Draw after the camera-centred Sky (which sorts as the nearest
      // transparent and would otherwise paint over the plumes against open
      // sky); depthTest still lets the opaque booster occlude them.
      renderOrder={2}
    />
  );
}
