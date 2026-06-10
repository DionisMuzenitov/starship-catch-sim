import { useState } from "react";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";

import { BoosterFlight } from "../sim/BoosterFlight";
import { SimStatusChip } from "../sim/SimStatusChip";
import { useSimRunner } from "../sim/useSimRunner";
import { useCameraStore } from "../state/cameraStore";

import { CameraRig } from "./camera/CameraRig";
import { CAMERA_FAR_M, CAMERA_NEAR_M } from "./constants";
import { DebugHud, DebugSampler, type DebugSample } from "./DebugOverlay";
import { Fog } from "./Fog";
import { Ground } from "./Ground";
import { PostFX } from "./PostFX";
import { Sky } from "./Sky";
import { Sun } from "./Sun";

export function Scene() {
  useSimRunner();
  const cameraMode = useCameraStore((s) => s.mode);
  const [sample, setSample] = useState<DebugSample>({
    fps: 0,
    x: 0,
    y: 0,
    z: 0,
  });

  return (
    <div className="relative h-full w-full">
      <Canvas
        gl={{ logarithmicDepthBuffer: true, antialias: false }}
        camera={{
          // Initial position is a sensible fallback; CameraRig damps to
          // the active mode's target from here on first frame.
          position: [220, 820, 220],
          fov: 50,
          near: CAMERA_NEAR_M,
          far: CAMERA_FAR_M,
        }}
      >
        <Fog />
        <Sun />
        <Sky />
        <Ground />
        <BoosterFlight />
        <CameraRig />
        <OrbitControls
          enabled={cameraMode === "free"}
          target={[0, 800, 0]}
          maxDistance={20_000}
          minDistance={5}
          enablePan={false}
        />
        <PostFX />
        <DebugSampler onSample={setSample} />
      </Canvas>
      <DebugHud sample={sample} />
      <SimStatusChip />
    </div>
  );
}
