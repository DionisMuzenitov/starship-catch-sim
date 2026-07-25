/**
 * Renders the active vehicle (Booster or Starship) AND its engine plumes under
 * one shared body group, and drives that group's whole-body transform
 * **imperatively in `useFrame`** — reading the interpolated render pose from the
 * store and mutating the three.js group directly, never through React props.
 *
 * **Why imperative (SLS-91).** Driving a 60 fps transform through React state
 * (a `position` prop + an `attitude` layout effect, fed by a store
 * subscription) makes the body stutter — the transform lands on React's commit
 * cadence, not the render loop, so the booster "teleports" back and forward
 * against a scene whose other objects (the camera, `CameraRig`) mutate their
 * three.js objects directly in `useFrame` and stay smooth. R3F's own guidance
 * is to mutate objects in `useFrame`, not via state. So the whole-body pose is
 * applied here, imperatively, like the camera.
 *
 * The model + plumes are CHILDREN of this one group, so they share a single
 * body transform (SLS-88 lockstep + the SLS-90 single-source structure): the
 * plumes can never drift from the nozzles because there is only one anchor.
 * The model still receives engine/surface states as props for articulation
 * (fin deflection, engine gimbal) — those are small body-frame motions, not the
 * whole-body translation that was juddering.
 *
 * Vehicle choice inspects the world payload (engine-state count) rather than
 * the scenario id, so a stale-store frame during a scenario switch still picks
 * a model whose shape matches the world it's about to render.
 */

import { useRef } from "react";

import { useFrame } from "@react-three/fiber";
import { Vec3, type Quat } from "@starship-catch-sim/physics";
import { type Group } from "three";

import { VehicleModel, isShipWorld } from "../models/glb";
import { EnginePlumes } from "../scene/EnginePlumes.js";
import { useSimStore } from "../state/simStore.js";

/** The whole-body pose lives on the shared group (set imperatively below), so
 *  the model's own outer transform is a no-op — feed it identity. */
const BODY_LOCAL_POSITION = Vec3.ZERO;
const BODY_LOCAL_ATTITUDE: Quat = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

export function BoosterFlight() {
  const bodyRef = useRef<Group>(null);
  // Subscribe for the things that legitimately drive React: which model to
  // mount, its articulation states, and the altitude fade. The whole-body
  // POSE is NOT taken from here — it is mutated imperatively in useFrame.
  const world = useSimStore((s) => s.world);
  const isShip = isShipWorld(world);
  const altitudeFactor = Math.min(
    1,
    Math.max(0, world.rigidBody.position.y / 100_000),
  );

  // Imperative whole-body transform — smooth, in lockstep with everything else
  // that updates in the render loop (camera, plumes). Read the latest
  // interpolated pose and write it straight onto the group.
  useFrame(() => {
    const g = bodyRef.current;
    if (!g) return;
    const rb = useSimStore.getState().world.rigidBody;
    g.position.set(rb.position.x, rb.position.y, rb.position.z);
    g.quaternion.set(rb.attitude.x, rb.attitude.y, rb.attitude.z, rb.attitude.w);
  });

  return (
    <group ref={bodyRef}>
      <VehicleModel
        isShip={isShip}
        position={BODY_LOCAL_POSITION}
        attitude={BODY_LOCAL_ATTITUDE}
        engineStates={world.engineStates}
        surfaceStates={world.surfaceStates}
        altitudeFactor={altitudeFactor}
      />
      <EnginePlumes isShip={isShip} />
    </group>
  );
}
