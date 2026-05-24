import { useLayoutEffect, useRef } from "react";

import {
  ShipFlaps,
  StarshipEngines,
  type EngineState,
  type Quat,
  type SurfaceState,
  type Vec3,
} from "@starship-catch-sim/physics";
import type { Group } from "three";

import { EngineBell } from "./EngineBell";
import { Flame } from "./Flame";
import { Flap } from "./Flap";
import { getSteelMaterial } from "./materials";

// Matches packages/physics/src/presets/starship.ts: height 50 m, radius 4.5 m,
// body frame origin at the stage bottom (y=0).
const BODY_HEIGHT = 50;
const BODY_RADIUS = 4.5;
const NOSE_HEIGHT = 10;

// Sea-level Raptor bell vs. Vacuum Raptor bell (the vacs are noticeably
// bigger — wider exit, longer body for the high-expansion nozzle).
const SL_BELL_LENGTH = 3.0;
const SL_BELL_EXIT = 0.65;
const SL_BELL_THROAT = 0.25;
const SL_FLAME_LENGTH = 15;
const SL_FLAME_RADIUS = 0.7;

const VAC_BELL_LENGTH = 4.0;
const VAC_BELL_EXIT = 1.2;
const VAC_BELL_THROAT = 0.35;
const VAC_FLAME_LENGTH = 22;
const VAC_FLAME_RADIUS = 1.25;

type Props = {
  position: Vec3;
  attitude: Quat;
  engineStates: readonly EngineState[];
  surfaceStates: readonly SurfaceState[];
  altitudeFactor?: number;
};

export function StarshipModel({
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

  if (engineStates.length !== StarshipEngines.length) {
    throw new Error(
      `StarshipModel: expected ${StarshipEngines.length} engine states, got ${engineStates.length}`,
    );
  }
  if (surfaceStates.length !== ShipFlaps.length) {
    throw new Error(
      `StarshipModel: expected ${ShipFlaps.length} surface states, got ${surfaceStates.length}`,
    );
  }

  // First 3 engines are sea-level (gimballed centre cluster), next 3 are
  // vacuum-optimised on a wider ring. Matches packages/physics/src/presets/
  // starship-engines.ts:36-48.
  const SL_COUNT = 3;

  return (
    <group ref={groupRef} position={[position.x, position.y, position.z]}>
      {/* Main cylindrical body from y=0 up to BODY_HEIGHT - NOSE_HEIGHT. */}
      <mesh
        position={[0, (BODY_HEIGHT - NOSE_HEIGHT) / 2, 0]}
        material={getSteelMaterial()}
      >
        <cylinderGeometry
          args={[BODY_RADIUS, BODY_RADIUS, BODY_HEIGHT - NOSE_HEIGHT, 48]}
        />
      </mesh>

      {/* Nose cone — tapered cap. coneGeometry's apex is at +Y. */}
      <mesh
        position={[0, BODY_HEIGHT - NOSE_HEIGHT / 2, 0]}
        material={getSteelMaterial()}
      >
        <coneGeometry args={[BODY_RADIUS, NOSE_HEIGHT, 48]} />
      </mesh>

      {StarshipEngines.map((engine, i) => {
        const isSL = i < SL_COUNT;
        return (
          <EngineBell
            key={`bell-${i}`}
            mountX={engine.mount.x}
            mountZ={engine.mount.z}
            state={engineStates[i]!}
            exitRadius={isSL ? SL_BELL_EXIT : VAC_BELL_EXIT}
            throatRadius={isSL ? SL_BELL_THROAT : VAC_BELL_THROAT}
            length={isSL ? SL_BELL_LENGTH : VAC_BELL_LENGTH}
          />
        );
      })}

      {StarshipEngines.map((engine, i) => {
        const isSL = i < SL_COUNT;
        return (
          <Flame
            key={`flame-${i}`}
            mountX={engine.mount.x}
            mountZ={engine.mount.z}
            state={engineStates[i]!}
            maxLength={isSL ? SL_FLAME_LENGTH : VAC_FLAME_LENGTH}
            baseRadius={isSL ? SL_FLAME_RADIUS : VAC_FLAME_RADIUS}
            altitudeFactor={altitudeFactor}
            bellLength={isSL ? SL_BELL_LENGTH : VAC_BELL_LENGTH}
          />
        );
      })}

      {ShipFlaps.map((flap, i) => (
        <Flap
          key={`flap-${i}`}
          surface={flap}
          state={surfaceStates[i]!}
          bodyRadius={BODY_RADIUS}
        />
      ))}
    </group>
  );
}
