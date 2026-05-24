import { useLayoutEffect, useRef } from "react";

import {
  BoosterFins,
  SuperHeavyEngines,
  type EngineState,
  type Quat,
  type SurfaceState,
  type Vec3,
} from "@starship-catch-sim/physics";
import type { Group } from "three";

import { EngineBell } from "./EngineBell";
import { Flame } from "./Flame";
import { GridFin } from "./GridFin";
import { getSteelMaterial } from "./materials";

// Matches packages/physics/src/presets/super-heavy.ts:
// height 71 m, radius 4.5 m, body frame origin at the engine plane (y=0).
const BODY_HEIGHT = 71;
const BODY_RADIUS = 4.5;
const TAPER_HEIGHT = 3;
const TAPER_TOP_RADIUS = 4.0; // slight chines/hot-stage ring
const INTERSTAGE_RING_HEIGHT = 1.5;
const INTERSTAGE_RING_RADIUS = 4.6; // marginally wider than body

// Sea-level Raptor visual dimensions.
const BELL_LENGTH = 3.0;
const BELL_EXIT_RADIUS = 0.65;
const BELL_THROAT_RADIUS = 0.25;
const FLAME_LENGTH = 18;
const FLAME_BASE_RADIUS = 0.7;

type Props = {
  position: Vec3;
  attitude: Quat;
  engineStates: readonly EngineState[];
  surfaceStates: readonly SurfaceState[];
  /** 0 at sea level, 1 in vacuum. Used to fade flames as we leave the atmosphere. */
  altitudeFactor?: number;
};

export function BoosterModel({
  position,
  attitude,
  engineStates,
  surfaceStates,
  altitudeFactor = 0,
}: Props) {
  const groupRef = useRef<Group>(null);

  useLayoutEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.quaternion.set(
      attitude.x,
      attitude.y,
      attitude.z,
      attitude.w,
    );
  }, [attitude]);

  if (engineStates.length !== SuperHeavyEngines.length) {
    throw new Error(
      `BoosterModel: expected ${SuperHeavyEngines.length} engine states, got ${engineStates.length}`,
    );
  }
  if (surfaceStates.length !== BoosterFins.length) {
    throw new Error(
      `BoosterModel: expected ${BoosterFins.length} surface states, got ${surfaceStates.length}`,
    );
  }

  return (
    <group ref={groupRef} position={[position.x, position.y, position.z]}>
      {/* Main body — cylinder from engine plane (y=0) up to the start of
          the taper near the top. */}
      <mesh
        position={[0, (BODY_HEIGHT - TAPER_HEIGHT) / 2, 0]}
        material={getSteelMaterial()}
      >
        <cylinderGeometry
          args={[BODY_RADIUS, BODY_RADIUS, BODY_HEIGHT - TAPER_HEIGHT, 48]}
        />
      </mesh>

      {/* Small taper at the top — leads into the interstage. */}
      <mesh
        position={[0, BODY_HEIGHT - TAPER_HEIGHT / 2, 0]}
        material={getSteelMaterial()}
      >
        <cylinderGeometry
          args={[TAPER_TOP_RADIUS, BODY_RADIUS, TAPER_HEIGHT, 48]}
        />
      </mesh>

      {/* Interstage / hot-stage ring above the body. */}
      <mesh
        position={[0, BODY_HEIGHT + INTERSTAGE_RING_HEIGHT / 2, 0]}
        material={getSteelMaterial()}
      >
        <cylinderGeometry
          args={[
            INTERSTAGE_RING_RADIUS,
            INTERSTAGE_RING_RADIUS,
            INTERSTAGE_RING_HEIGHT,
            48,
          ]}
        />
      </mesh>

      {SuperHeavyEngines.map((engine, i) => (
        <EngineBell
          key={`bell-${i}`}
          mountX={engine.mount.x}
          mountZ={engine.mount.z}
          state={engineStates[i]!}
          exitRadius={BELL_EXIT_RADIUS}
          throatRadius={BELL_THROAT_RADIUS}
          length={BELL_LENGTH}
        />
      ))}

      {SuperHeavyEngines.map((engine, i) => (
        <Flame
          key={`flame-${i}`}
          mountX={engine.mount.x}
          mountZ={engine.mount.z}
          state={engineStates[i]!}
          maxLength={FLAME_LENGTH}
          baseRadius={FLAME_BASE_RADIUS}
          altitudeFactor={altitudeFactor}
          bellLength={BELL_LENGTH}
        />
      ))}

      {BoosterFins.map((fin, i) => (
        <GridFin
          key={`fin-${i}`}
          surface={fin}
          state={surfaceStates[i]!}
          bodyRadius={BODY_RADIUS}
        />
      ))}
    </group>
  );
}
