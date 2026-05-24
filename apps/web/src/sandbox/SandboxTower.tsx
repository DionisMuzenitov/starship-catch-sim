import { useEffect, useMemo, useRef, useState } from "react";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import {
  BoosterFins,
  SuperHeavyEngines,
  Quat,
  Vec3,
  type EngineState,
  type SurfaceState,
} from "@starship-catch-sim/physics";

import { BoosterModel } from "../models";
import { CAMERA_FAR_M, CAMERA_NEAR_M } from "../scene/constants";
import { DebugHud, DebugSampler, type DebugSample } from "../scene/DebugOverlay";
import { Fog } from "../scene/Fog";
import { Ground } from "../scene/Ground";
import {
  MechazillaTower,
  type MechazillaApi,
} from "../scene/MechazillaTower";
import { PostFX } from "../scene/PostFX";
import { Sky } from "../scene/Sky";
import { Sun } from "../scene/Sun";

import { TowerControlPanel } from "./TowerControlPanel";
import {
  DEFAULT_TOWER_STATE,
  type TowerControlState,
} from "./towerControlState";

const IDENTITY_QUAT: Quat = { x: 0, y: 0, z: 0, w: 1 };
// Real Mechazilla: rocket sits on the orbital launch mount adjacent to the
// tower on its rocket-facing side. The chopsticks reach out to grasp it.
// Place the booster so its body is centred over the inner gripper pads when
// the arms are closed: hinge X ≈ 7.5, fore/aft pad mid-point ≈ +1, so the
// rocket axis sits ≈ 8.5 m from the tower centreline. Use 9 m for some
// breathing room (rocket radius 4.5 m, arm hinge offset ±5 m in Z).
const BOOSTER_X = 9;
const BOOSTER_Z = 0;

export function SandboxTower() {
  const [controls, setControls] = useState<TowerControlState>(DEFAULT_TOWER_STATE);
  const [sample, setSample] = useState<DebugSample>({
    fps: 0,
    x: 0,
    y: 0,
    z: 0,
  });
  const towerRef = useRef<MechazillaApi>(null);

  // Drive the tower's imperative API from the panel state.
  useEffect(() => {
    towerRef.current?.setOpening(controls.opening);
  }, [controls.opening]);
  useEffect(() => {
    towerRef.current?.setArmHeight(controls.armHeight);
  }, [controls.armHeight]);
  useEffect(() => {
    towerRef.current?.setDebugVisible(controls.debug);
  }, [controls.debug]);

  const onCloseOnTarget = () => {
    const target: Vec3 = { x: BOOSTER_X, y: controls.boosterY, z: BOOSTER_Z };
    towerRef.current?.closeOnTarget(target);
    // Reflect the commanded values back into the panel so sliders match
    // what the API is doing.
    setControls((s) => ({
      ...s,
      opening: 0,
      armHeight: Math.min(130, Math.max(30, controls.boosterY)),
    }));
  };

  const boosterEngineStates = useMemo<EngineState[]>(
    () =>
      SuperHeavyEngines.map(() => ({
        gimbalPitch: 0,
        gimbalYaw: 0,
        throttle: controls.boosterThrottle,
        on: controls.boosterThrottle > 0.01,
      })),
    [controls.boosterThrottle],
  );

  const finStates = useMemo<SurfaceState[]>(
    () => BoosterFins.map(() => ({ deflection: 0 })),
    [],
  );

  return (
    <div className="relative h-full w-full">
      <Canvas
        gl={{ logarithmicDepthBuffer: true, antialias: false }}
        camera={{
          position: [180, 110, 220],
          fov: 50,
          near: CAMERA_NEAR_M,
          far: CAMERA_FAR_M,
        }}
      >
        <Fog />
        <Sun />
        <Sky />
        <Ground />
        <MechazillaTower ref={towerRef} />
        <BoosterModel
          position={{ x: BOOSTER_X, y: controls.boosterY, z: BOOSTER_Z }}
          attitude={IDENTITY_QUAT}
          engineStates={boosterEngineStates}
          surfaceStates={finStates}
          altitudeFactor={0}
        />
        <OrbitControls
          target={[BOOSTER_X / 2, 90, 0]}
          maxDistance={500}
          minDistance={15}
        />
        <PostFX />
        <DebugSampler onSample={setSample} />
      </Canvas>
      <DebugHud sample={sample} />
      <TowerControlPanel
        state={controls}
        onChange={setControls}
        onCloseOnTarget={onCloseOnTarget}
      />
    </div>
  );
}
