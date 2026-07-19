/**
 * Isolated chopstick-collider lab (`/sandbox/arm`) — SLS-84.
 *
 * Shows ONE chopstick arm in vacuum with the segment-chain collider overlaid,
 * so the shape can be validated in isolation. The arm is a single long beam
 * mesh (not a box), so a single AABB is a poor proxy; `segmentChain` (shared
 * with the live sim) slices the arm's real geometry into N short bins along its
 * longest axis and bounds each slice with a tight AABB. `?n=` sets the segment
 * count, `?t=` a per-box inflate margin (m). Collision = booster centre inside
 * ANY box.
 */
import { useEffect, useMemo, useState } from "react";

import { OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Box3, MeshStandardMaterial, Vector3, type Mesh, type Object3D } from "three";

import { CAMERA_FAR_M, CAMERA_NEAR_M } from "../scene/constants";
import { segmentChain } from "../scene/armSegments";
import { DRACO_DECODER_PATH, TOWER_GLB_URL } from "../scene/MechazillaTowerGLB";

function ArmWithChain({
  n,
  inflate,
  onInfo,
}: {
  n: number;
  inflate: number;
  onInfo: (s: string) => void;
}) {
  const { scene } = useGLTF(TOWER_GLB_URL, DRACO_DECODER_PATH) as unknown as {
    scene: Object3D;
  };
  const { arm, boxes, size, center, info } = useMemo(() => {
    const clone = scene.clone(true);
    const a = clone.getObjectByName("LeftChopstick");
    if (!a) {
      return { arm: null, boxes: [], size: 0, center: [0, 0, 0] as [number, number, number], info: "LeftChopstick NOT FOUND" };
    }
    a.position.set(0, 0, 0);
    a.rotation.set(0, 0, 0);
    a.scale.set(1, 1, 1);
    // The GLB material is metallic and reads black without an env map; swap in
    // a plain matte material so the arm is clearly visible in this lab.
    a.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        mesh.material = new MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.1, roughness: 0.85 });
      }
    });
    // Same shared collider the live sim uses. Arm is at identity here, so its
    // world segment boxes double as the local ones for viewing.
    const boxes = segmentChain(a, n, inflate);
    const bb = new Box3().setFromObject(a);
    const s = new Vector3();
    const c = new Vector3();
    bb.getSize(s);
    bb.getCenter(c);
    const info = `found=true boxes=${boxes.length} size=[${s.toArray().map((v) => v.toFixed(1)).join(", ")}]`;
    return { arm: a, boxes, size: Math.max(s.x, s.y, s.z), center: [c.x, c.y, c.z] as [number, number, number], info };
  }, [scene, n, inflate]);

  useEffect(() => onInfo(info), [info, onInfo]);

  if (!arm) return null;
  return (
    <>
      <group position={[-center[0], -center[1], -center[2]]}>
        <primitive object={arm} />
        {boxes.map((b, i) => (
          <mesh key={i} position={[b.center.x, b.center.y, b.center.z]}>
            <boxGeometry args={[b.halfExtents.x * 2, b.halfExtents.y * 2, b.halfExtents.z * 2]} />
            <meshBasicMaterial
              color={i % 2 === 0 ? "#ff3b30" : "#ffcc00"}
              wireframe
              transparent
              opacity={0.85}
            />
          </mesh>
        ))}
      </group>
      <OrbitControls target={[0, 0, 0]} maxDistance={size * 4 + 20} minDistance={2} />
    </>
  );
}

function intParam(name: string, def: number): number {
  const p = new URLSearchParams(window.location.search).get(name);
  const v = p === null ? NaN : Number(p);
  return Number.isFinite(v) ? v : def;
}

export function ArmColliderLab() {
  const [n, setN] = useState(() => intParam("n", 15));
  const [inflate, setInflate] = useState(() => intParam("t", 0));
  const [info, setInfo] = useState("loading…");
  return (
    <div className="relative h-full w-full bg-neutral-900">
      <Canvas
        gl={{ antialias: true }}
        camera={{ position: [30, 20, 40], fov: 50, near: CAMERA_NEAR_M, far: CAMERA_FAR_M }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[40, 60, 20]} intensity={1.2} />
        <directionalLight position={[-30, 10, -40]} intensity={0.5} />
        <axesHelper args={[10]} />
        <ArmWithChain n={n} inflate={inflate} onInfo={setInfo} />
      </Canvas>
      <div className="pointer-events-auto absolute top-2 left-2 rounded bg-black/70 p-3 font-mono text-xs text-white">
        <div className="mb-2 font-bold">chopstick collider lab (SLS-84)</div>
        <label className="mb-2 block">
          <div className="flex justify-between">
            <span>segments</span>
            <span className="text-white/70">{n}</span>
          </div>
          <input className="w-48" type="range" min={1} max={24} step={1} value={n} onChange={(e) => setN(Number(e.target.value))} />
        </label>
        <label className="mb-2 block">
          <div className="flex justify-between">
            <span>inflate (m)</span>
            <span className="text-white/70">{inflate.toFixed(1)}</span>
          </div>
          <input className="w-48" type="range" min={0} max={6} step={0.5} value={inflate} onChange={(e) => setInflate(Number(e.target.value))} />
        </label>
        <div className="mt-1 text-white/50">
          one LeftChopstick in vacuum · {n} boxes trace the beam · red/yellow alternate
        </div>
        <div className="mt-1 break-all text-emerald-300">{info}</div>
      </div>
    </div>
  );
}
