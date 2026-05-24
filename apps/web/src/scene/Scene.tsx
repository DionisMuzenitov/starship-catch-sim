import { useState } from "react";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";

import { BoosterPlaceholder } from "./BoosterPlaceholder";
import { CAMERA_FAR_M, CAMERA_NEAR_M } from "./constants";
import { DebugHud, DebugSampler, type DebugSample } from "./DebugOverlay";
import { Fog } from "./Fog";
import { Ground } from "./Ground";
import { PostFX } from "./PostFX";
import { Sky } from "./Sky";
import { Sun } from "./Sun";

export function Scene() {
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
          position: [120, 80, 200],
          fov: 50,
          near: CAMERA_NEAR_M,
          far: CAMERA_FAR_M,
        }}
      >
        <Fog />
        <Sun />
        <Sky />
        <Ground />
        <BoosterPlaceholder />
        <OrbitControls
          target={[0, 35, 0]}
          maxDistance={20_000}
          minDistance={5}
        />
        <PostFX />
        <DebugSampler onSample={setSample} />
      </Canvas>
      <DebugHud sample={sample} />
    </div>
  );
}
