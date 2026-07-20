import { useState } from "react";

import { Canvas } from "@react-three/fiber";

import { Hud } from "../hud/Hud";
import { ImpactReticle } from "../hud/ImpactReticle";
import { ControllerSwitcher } from "../menu/ControllerSwitcher";
import { DocsLink } from "../menu/DocsLink";
import { FirstRunTutorial } from "../menu/FirstRunTutorial";
import { HelpOverlay } from "../menu/HelpOverlay";
import { MpcServiceBanner } from "../menu/MpcServiceBanner";
import { PidTuningPanel } from "../menu/PidTuningPanel";
import { ScenarioPicker } from "../menu/ScenarioPicker";
import { ReplayDriver } from "../replay/ReplayDriver";
import { ReplayPlayer } from "../replay/ReplayPlayer";
import { BoosterFlight } from "../sim/BoosterFlight";
import { useSimRunner } from "../sim/useSimRunner";

import { CameraRig } from "./camera/CameraRig";
import { FreeLookRig } from "./camera/FreeLookRig";
import { OrbitCameraRig } from "./camera/OrbitCameraRig";
import { CAMERA_FAR_M, CAMERA_NEAR_M } from "./constants";
import { EnginePlumes } from "./EnginePlumes";
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
        <EnginePlumes />
        <CameraRig />
        <ImpactReticle />
        <DragTrajectoryOverlay />
        <MpcPlanOverlay />
        {/* Per-mode camera controls (SLS-58). CameraRig: onboard/cinematic.
            OrbitCameraRig: chase (follow) + tower (fixed pivot), orbit + zoom.
            FreeLookRig: ground (look-in-place) + free (fly). */}
        <OrbitCameraRig />
        <FreeLookRig />
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
      <DocsLink />
      <ReplayDriver />
      <ReplayPlayer />
      <HelpOverlay />
      <FirstRunTutorial />
    </div>
  );
}
