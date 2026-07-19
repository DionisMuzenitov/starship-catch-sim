/**
 * Isolated booster-collider lab (`/sandbox/booster`) — SLS-86 / ADR-020.
 *
 * Shows the booster model with its collision CAPSULE overlaid, so the capsule
 * (radius + core half-length, and any vertical offset from the CoM) can be
 * dialled to match the real mesh outside the running sim. The sim's capsule is
 * centred at the booster CoM and rotates with attitude; here the booster is
 * upright at the origin so `offsetY` reveals whether the mesh origin sits at the
 * CoM. Read the values off the panel and bake them into `BOOSTER_CAPSULE`.
 */
import { useMemo, useState } from "react";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import {
  BoosterFins,
  BOOSTER_CAPSULE,
  Quat,
  SuperHeavyEngines,
  type EngineState,
  type SurfaceState,
} from "@starship-catch-sim/physics";

import { BoosterModel } from "../models";
import { CAMERA_FAR_M, CAMERA_NEAR_M } from "../scene/constants";
import { Sky } from "../scene/Sky";
import { Sun } from "../scene/Sun";

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ORIGIN = { x: 0, y: 0, z: 0 };

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="mb-2 block">
      <div className="flex justify-between">
        <span>{props.label}</span>
        <span className="text-white/70">{props.value.toFixed(1)} m</span>
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

export function BoosterColliderLab() {
  const [radius, setRadius] = useState(BOOSTER_CAPSULE.radius);
  const [halfLength, setHalfLength] = useState(BOOSTER_CAPSULE.halfLength);
  const [offsetY, setOffsetY] = useState(BOOSTER_CAPSULE.offset);

  const engineStates = useMemo<EngineState[]>(
    () =>
      SuperHeavyEngines.map(() => ({
        gimbalPitch: 0,
        gimbalYaw: 0,
        throttle: 0,
        on: false,
      })),
    [],
  );
  const finStates = useMemo<SurfaceState[]>(
    () => BoosterFins.map(() => ({ deflection: 0 })),
    [],
  );

  return (
    <div className="relative h-full w-full bg-neutral-900">
      <Canvas
        gl={{ logarithmicDepthBuffer: true, antialias: true }}
        camera={{ position: [70, 20, 90], fov: 50, near: CAMERA_NEAR_M, far: CAMERA_FAR_M }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[80, 100, 40]} intensity={1.2} />
        <Sun />
        <Sky />
        <BoosterModel
          position={ORIGIN}
          attitude={IDENTITY}
          engineStates={engineStates}
          surfaceStates={finStates}
          altitudeFactor={0}
        />
        {/* collision capsule: CapsuleGeometry axis is +Y = booster long axis */}
        <mesh position={[0, offsetY, 0]}>
          <capsuleGeometry args={[radius, halfLength * 2, 8, 20]} />
          <meshBasicMaterial color="#22ff88" wireframe transparent opacity={0.5} />
        </mesh>
        <axesHelper args={[15]} />
        <OrbitControls target={[0, 0, 0]} maxDistance={400} minDistance={10} />
      </Canvas>
      <div className="pointer-events-auto absolute top-2 left-2 rounded bg-black/70 p-3 font-mono text-xs text-white">
        <div className="mb-2 font-bold">booster collider lab (SLS-86)</div>
        <Slider label="radius" value={radius} min={2} max={8} step={0.1} onChange={setRadius} />
        <Slider label="core half-length" value={halfLength} min={10} max={40} step={0.5} onChange={setHalfLength} />
        <Slider label="offset up (y)" value={offsetY} min={-40} max={40} step={0.5} onChange={setOffsetY} />
        <div className="mt-1 text-white/50">
          green capsule = booster collider · total length ≈ {(halfLength * 2 + radius * 2).toFixed(0)} m
        </div>
        <div className="mt-1 text-emerald-300">
          bake → radius {radius.toFixed(1)}, halfLength {halfLength.toFixed(1)}
          {offsetY !== 0 ? `, offsetY ${offsetY.toFixed(1)}` : ""}
        </div>
      </div>
    </div>
  );
}
