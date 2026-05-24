import { useMemo, useRef } from "react";

import { useFrame } from "@react-three/fiber";
import type { EngineState } from "@starship-catch-sim/physics";
import {
  AdditiveBlending,
  CanvasTexture,
  type Group,
  type MeshBasicMaterial,
  RepeatWrapping,
} from "three";

type Props = {
  mountX: number;
  mountZ: number;
  state: EngineState;
  /** Max flame length at full throttle, sea level (m). */
  maxLength: number;
  /** Flame radius at the engine exit (root of the cone) (m). */
  baseRadius: number;
  /** 0 at sea level, 1 in vacuum. Drives length + opacity falloff. */
  altitudeFactor: number;
  /** Bell length so the flame starts at the exit plane, not the throat. */
  bellLength: number;
};

// Pre-baked noise + length-fade texture, mapped over the cone side face so
// the flame reads as turbulent without a custom shader. The "or a pre-baked
// texture" branch of the SLS-15 spec.
let cachedFlameTexture: CanvasTexture | null = null;
function buildFlameTexture(): CanvasTexture {
  if (cachedFlameTexture) return cachedFlameTexture;
  const W = 128;
  const H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  // Per-row alpha falls from 1 at the top (root, v=1) to 0 at the bottom
  // (tip, v=0). Per-pixel turbulence multiplies that.
  for (let y = 0; y < H; y += 1) {
    const v = 1 - y / (H - 1);
    const lengthwise = 1 - smoothstep(0, 1, 1 - v);
    // Colour ramp: white-hot at root → yellow → orange → red tip.
    const t = 1 - v;
    const r = t < 0.5 ? 255 : 255 * (1 - (t - 0.5) * 0.3);
    const g = t < 0.4 ? 255 - 100 * t : Math.max(60, 200 - 300 * t);
    const b = t < 0.3 ? 220 - 500 * t : Math.max(20, 40 - 50 * t);
    for (let x = 0; x < W; x += 1) {
      const n =
        0.6 +
        0.4 *
          (0.5 +
            0.5 *
              Math.sin(
                x * 0.45 + y * 0.18 + Math.sin(y * 0.07) * 4,
              ));
      const a = Math.max(0, Math.min(255, lengthwise * n * 255));
      const i = (y * W + x) * 4;
      img.data[i + 0] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  cachedFlameTexture = tex;
  return tex;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function Flame({
  mountX,
  mountZ,
  state,
  maxLength,
  baseRadius,
  altitudeFactor,
  bellLength,
}: Props) {
  const groupRef = useRef<Group>(null);
  const matRef = useRef<MeshBasicMaterial>(null);
  const texture = useMemo(buildFlameTexture, []);

  useFrame(() => {
    const throttle = state.on ? state.throttle : 0;
    const atmFade = 1 - 0.7 * altitudeFactor;
    const factor = throttle * atmFade;

    if (groupRef.current) {
      groupRef.current.scale.y = Math.max(factor, 0.0001);
      groupRef.current.visible = throttle > 0.01;
    }
    if (matRef.current) {
      matRef.current.opacity = factor;
    }
  });

  return (
    <group ref={groupRef} position={[mountX, -bellLength, mountZ]}>
      <mesh position={[0, -maxLength / 2, 0]} renderOrder={2}>
        <cylinderGeometry
          args={[baseRadius, baseRadius * 0.25, maxLength, 16, 1, true]}
        />
        <meshBasicMaterial
          ref={matRef}
          map={texture}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          opacity={0}
        />
      </mesh>
    </group>
  );
}
