import { useMemo, useState } from "react";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import {
  BoosterFins,
  ShipFlaps,
  StarshipEngines,
  SuperHeavyEngines,
  Vec3,
  Quat,
  type EngineState,
  type SurfaceState,
} from "@starship-catch-sim/physics";

import { BoosterModel, StarshipModel } from "../models";
import { CAMERA_FAR_M, CAMERA_NEAR_M } from "../scene/constants";
import { DebugHud, DebugSampler, type DebugSample } from "../scene/DebugOverlay";
import { Fog } from "../scene/Fog";
import { Ground } from "../scene/Ground";
import { PostFX } from "../scene/PostFX";
import { Sky } from "../scene/Sky";
import { Sun } from "../scene/Sun";

import { ControlPanel } from "./ControlPanel";
import { DEFAULT_CONTROL_STATE } from "./controlState";

const IDENTITY_QUAT: Quat = { x: 0, y: 0, z: 0, w: 1 };
// Vehicles sit elevated so engine bells + flames render above the ground
// plane. The "hover test stand" framing makes the engines easy to inspect
// in this sandbox; the production scene will position vehicles based on
// physics state.
const HOVER_HEIGHT = 25;
const BOOSTER_POS: Vec3 = { x: -30, y: HOVER_HEIGHT, z: 0 };
const SHIP_POS: Vec3 = { x: 30, y: HOVER_HEIGHT, z: 0 };

export function SandboxModels() {
  const [controls, setControls] = useState(DEFAULT_CONTROL_STATE);
  const [sample, setSample] = useState<DebugSample>({
    fps: 0,
    x: 0,
    y: 0,
    z: 0,
  });

  const boosterEngineStates = useMemo<EngineState[]>(
    () =>
      SuperHeavyEngines.map(() => ({
        gimbalPitch: 0,
        gimbalYaw: 0,
        throttle: controls.boosterThrottle,
        on: controls.enginesOn,
      })),
    [controls.boosterThrottle, controls.enginesOn],
  );

  const shipEngineStates = useMemo<EngineState[]>(
    () =>
      StarshipEngines.map(() => ({
        gimbalPitch: 0,
        gimbalYaw: 0,
        throttle: controls.shipThrottle,
        on: controls.enginesOn,
      })),
    [controls.shipThrottle, controls.enginesOn],
  );

  const finStates = useMemo<SurfaceState[]>(
    () =>
      BoosterFins.map((_, i) => ({ deflection: controls.finDeflections[i]! })),
    [controls.finDeflections],
  );

  const flapStates = useMemo<SurfaceState[]>(
    () =>
      ShipFlaps.map((_, i) => ({ deflection: controls.flapDeflections[i]! })),
    [controls.flapDeflections],
  );

  return (
    <div className="relative h-full w-full">
      <Canvas
        gl={{ logarithmicDepthBuffer: true, antialias: false }}
        camera={{
          position: [80, 70, 160],
          fov: 50,
          near: CAMERA_NEAR_M,
          far: CAMERA_FAR_M,
        }}
      >
        <Fog />
        <Sun />
        <Sky />
        <Ground />
        <BoosterModel
          position={BOOSTER_POS}
          attitude={IDENTITY_QUAT}
          engineStates={boosterEngineStates}
          surfaceStates={finStates}
          altitudeFactor={controls.altitudeFactor}
        />
        <StarshipModel
          position={SHIP_POS}
          attitude={IDENTITY_QUAT}
          engineStates={shipEngineStates}
          surfaceStates={flapStates}
          altitudeFactor={controls.altitudeFactor}
        />
        <OrbitControls
          target={[0, 50, 0]}
          maxDistance={500}
          minDistance={10}
        />
        <PostFX />
        <DebugSampler onSample={setSample} />
      </Canvas>
      <DebugHud sample={sample} />
      <ControlPanel state={controls} onChange={setControls} />
    </div>
  );
}
