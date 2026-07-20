/**
 * Isolated engine-plume lab (`/sandbox/plumes`) — SLS-60.
 *
 * Renders the booster upright at the origin with the engine-plume VFX driven by
 * sliders (throttle, altitude regime, how many engines fire, gimbal) instead of
 * the flight sim. This is where the flame is developed + tuned: the booster
 * never moves, so you can watch the plume at sea level (tight, bright, banded)
 * and in vacuum (wide, faint) directly, then the live sim inherits the exact
 * same look via the shared `plumeInstances` core.
 */
import { Suspense, useMemo, useRef, useState } from "react";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import {
  BoosterFins,
  Quat,
  SuperHeavyEngines,
  type EngineState,
  type SurfaceState,
} from "@starship-catch-sim/physics";
import { type InstancedMesh } from "three";

import { VehicleModel } from "../models/glb";
import { CAMERA_FAR_M, CAMERA_NEAR_M } from "../scene/constants";
import {
  MAX_PLUMES,
  PLUME_CENTER_OFFSET,
  PLUME_MOUNT_SCALE,
  makePlumeGeometry,
  makePlumeMaterial,
  updatePlumeInstances,
} from "../scene/plumeInstances";
import { Sky } from "../scene/Sky";
import { Sun } from "../scene/Sun";

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ORIGIN = { x: 0, y: 0, z: 0 };

type Controls = {
  throttle: number;
  altitudeKm: number;
  engineCount: number;
  gimbalDeg: number;
  mountScale: number;
  centerX: number;
  centerY: number;
  centerZ: number;
};

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="mb-2 block">
      <div className="flex justify-between">
        <span>{props.label}</span>
        <span className="text-white/70">
          {props.value.toFixed(props.step < 1 ? 2 : 0)}
          {props.unit}
        </span>
      </div>
      <input
        className="w-56"
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

/** The plume instanced mesh, driven by the lab controls (not the sim store). */
function LabPlumes({
  throttle,
  altitudeKm,
  engineCount,
  gimbalDeg,
  mountScale,
  centerX,
  centerY,
  centerZ,
}: Controls) {
  const meshRef = useRef<InstancedMesh>(null);
  const geometry = useMemo(makePlumeGeometry, []);
  const material = useMemo(makePlumeMaterial, []);
  const gimbal = (gimbalDeg * Math.PI) / 180;

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const engineStates: EngineState[] = SuperHeavyEngines.map((_, i) => ({
      gimbalPitch: gimbal,
      gimbalYaw: 0,
      throttle: i < engineCount ? throttle : 0,
      on: i < engineCount && throttle > 0,
    }));
    // Booster is upright at the origin: mesh stays at identity.
    updatePlumeInstances(mesh, {
      engines: SuperHeavyEngines,
      engineStates,
      plumeCount: engineCount,
      altitudeM: altitudeKm * 1000,
      t: state.clock.elapsedTime,
      mountScale,
      centerOffset: { x: centerX, y: centerY, z: centerZ },
    });
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_PLUMES]}
      frustumCulled={false}
      renderOrder={2}
    />
  );
}

export function EnginePlumeLab() {
  const [c, setC] = useState<Controls>({
    throttle: 0.8,
    altitudeKm: 0,
    engineCount: 13,
    gimbalDeg: 0,
    mountScale: PLUME_MOUNT_SCALE,
    centerX: PLUME_CENTER_OFFSET.x,
    centerY: PLUME_CENTER_OFFSET.y,
    centerZ: PLUME_CENTER_OFFSET.z,
  });
  const set = (patch: Partial<Controls>) => setC((s) => ({ ...s, ...patch }));

  // The GLB model wants a full 33-engine + 4-fin state; gimbal the firing ones
  // so the drawn nozzles tilt with their plumes.
  const gimbal = (c.gimbalDeg * Math.PI) / 180;
  const engineStates = useMemo<EngineState[]>(
    () =>
      SuperHeavyEngines.map((_, i) => ({
        gimbalPitch: gimbal,
        gimbalYaw: 0,
        throttle: i < c.engineCount ? c.throttle : 0,
        on: i < c.engineCount && c.throttle > 0,
      })),
    [gimbal, c.engineCount, c.throttle],
  );
  const finStates = useMemo<SurfaceState[]>(
    () => BoosterFins.map(() => ({ deflection: 0 })),
    [],
  );

  return (
    <div className="relative h-full w-full bg-neutral-900">
      <Canvas
        gl={{ logarithmicDepthBuffer: true, antialias: true }}
        camera={{
          position: [34, -6, 44],
          fov: 50,
          near: CAMERA_NEAR_M,
          far: CAMERA_FAR_M,
        }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[80, 100, 40]} intensity={1.1} />
        <Sun />
        <Sky />
        <Suspense fallback={null}>
          <VehicleModel
            isShip={false}
            position={ORIGIN}
            attitude={IDENTITY}
            engineStates={engineStates}
            surfaceStates={finStates}
            altitudeFactor={0}
          />
        </Suspense>
        <LabPlumes {...c} />
        <EffectComposer>
          <Bloom intensity={0.25} luminanceThreshold={0.85} mipmapBlur />
        </EffectComposer>
        <axesHelper args={[10]} />
        <OrbitControls target={[0, -8, 0]} maxDistance={400} minDistance={8} />
      </Canvas>
      <div className="pointer-events-auto absolute top-2 left-2 rounded bg-black/70 p-3 font-mono text-xs text-white">
        <div className="mb-2 font-bold">engine plume lab (SLS-60)</div>
        <Slider
          label="throttle"
          value={c.throttle}
          min={0}
          max={1}
          step={0.01}
          unit=""
          onChange={(v) => set({ throttle: v })}
        />
        <Slider
          label="altitude"
          value={c.altitudeKm}
          min={0}
          max={80}
          step={1}
          unit=" km"
          onChange={(v) => set({ altitudeKm: v })}
        />
        <Slider
          label="engines firing"
          value={c.engineCount}
          min={0}
          max={MAX_PLUMES}
          step={1}
          unit=""
          onChange={(v) => set({ engineCount: v })}
        />
        <Slider
          label="gimbal"
          value={c.gimbalDeg}
          min={-15}
          max={15}
          step={0.5}
          unit="°"
          onChange={(v) => set({ gimbalDeg: v })}
        />
        <Slider
          label="mount scale"
          value={c.mountScale}
          min={0.7}
          max={1.6}
          step={0.005}
          unit="×"
          onChange={(v) => set({ mountScale: v })}
        />
        <Slider
          label="center X"
          value={c.centerX}
          min={-4}
          max={4}
          step={0.05}
          unit=" m"
          onChange={(v) => set({ centerX: v })}
        />
        <Slider
          label="center Y"
          value={c.centerY}
          min={-4}
          max={4}
          step={0.05}
          unit=" m"
          onChange={(v) => set({ centerY: v })}
        />
        <Slider
          label="center Z"
          value={c.centerZ}
          min={-4}
          max={4}
          step={0.05}
          unit=" m"
          onChange={(v) => set({ centerZ: v })}
        />
        <div className="mt-1 text-emerald-300">
          center the flames on the bells, then tell me these →{" "}
          scale {c.mountScale.toFixed(3)} · offset ({c.centerX.toFixed(2)},{" "}
          {c.centerY.toFixed(2)}, {c.centerZ.toFixed(2)})
        </div>
        <div className="mt-1 text-white/50">
          sea level = tight + bright · high altitude = wide + faint
        </div>
      </div>
    </div>
  );
}
