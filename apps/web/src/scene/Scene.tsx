import { useState } from "react";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";

import { Hud } from "../hud/Hud";
import { ImpactReticle } from "../hud/ImpactReticle";
import { ControllerSwitcher } from "../menu/ControllerSwitcher";
import { MpcServiceBanner } from "../menu/MpcServiceBanner";
import { PidTuningPanel } from "../menu/PidTuningPanel";
import { ScenarioPicker } from "../menu/ScenarioPicker";
import { ReplayDriver } from "../replay/ReplayDriver";
import { ReplayPlayer } from "../replay/ReplayPlayer";
import { BoosterFlight } from "../sim/BoosterFlight";
import { useSimRunner } from "../sim/useSimRunner";
import { useCameraStore } from "../state/cameraStore";

import { CameraRig } from "./camera/CameraRig";
import { CAMERA_FAR_M, CAMERA_NEAR_M } from "./constants";
import { DebugHud, DebugSampler, type DebugSample } from "./DebugOverlay";
import { Fog } from "./Fog";
import { LaunchSite } from "./LaunchSite";
import { PostFX } from "./PostFX";
import { Sky } from "./Sky";
import { Sun } from "./Sun";
import { Terrain } from "./terrain/Terrain";
import { TowerTunePanel } from "./TowerTunePanel";
import { DragTrajectoryOverlay } from "./trajectory/DragTrajectoryOverlay";
import { MpcPlanOverlay } from "./trajectory/MpcPlanOverlay";
import { LandingGhost } from "./LandingGhost";
import { CollisionDebug } from "./CollisionDebug";
import { SITE_OFFSET, towerTuneEnabled } from "../state/towerTuneStore";

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
          position: [220, 820, 220],
          fov: 50,
          near: CAMERA_NEAR_M,
          far: CAMERA_FAR_M,
        }}
      >
        <Fog />
        <Sun />
        <Sky />
        {/* site visuals shifted as one so the visual catch cradle sits on the
            physics catch point without disturbing the tower↔terrain alignment
            (SLS-76; zero until the owner bakes the ghost position) */}
        <group position={[...SITE_OFFSET]}>
          <Terrain />
          <LaunchSite />
        </group>
        {towerTuneEnabled() && <LandingGhost />}
        {towerTuneEnabled() && <CollisionDebug />}
        <BoosterFlight />
        <CameraRig />
        <ImpactReticle />
        <DragTrajectoryOverlay />
        <MpcPlanOverlay />
        <OrbitControls
          enabled={cameraMode === "free"}
          // When tuning (?tune=1) pivot the free camera on the tower catch
          // point so O starts framed on the chopsticks; otherwise keep the
          // high sky pivot for watching the descent. Panning is enabled so
          // the camera can actually translate through space (right-drag /
          // two-finger drag), not just orbit a fixed point.
          target={towerTuneEnabled() ? [8.5, 91, 0] : [0, 800, 0]}
          maxDistance={20_000}
          minDistance={2}
          enablePan
          screenSpacePanning
        />
        <PostFX />
        <DebugSampler onSample={setSample} />
      </Canvas>
      <DebugHud sample={sample} />
      <ScenarioPicker />
      <ControllerSwitcher />
      <MpcServiceBanner />
      <PidTuningPanel />
      <Hud />
      {towerTuneEnabled() && <TowerTunePanel />}
      <ReplayDriver />
      <ReplayPlayer />
    </div>
  );
}
