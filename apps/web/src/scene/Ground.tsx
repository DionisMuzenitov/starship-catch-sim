import { useMemo } from "react";

import {
  CanvasTexture,
  type Texture,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";

import { GROUND_GRID_M, GROUND_SIZE_M } from "./constants";

function buildGridTexture(): Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#3a3f47";
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "#5b6470";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);

  ctx.strokeStyle = "#4a525c";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i += 1) {
    const p = (i * size) / 4;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  const repeats = GROUND_SIZE_M / GROUND_GRID_M;
  tex.repeat.set(repeats, repeats);
  tex.anisotropy = 8;
  return tex;
}

export function Ground() {
  const texture = useMemo(buildGridTexture, []);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[GROUND_SIZE_M, GROUND_SIZE_M, 1, 1]} />
      <meshStandardMaterial map={texture} roughness={0.95} metalness={0.0} />
    </mesh>
  );
}
