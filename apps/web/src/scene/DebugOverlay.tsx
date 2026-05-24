import { useRef } from "react";

import { useFrame, useThree } from "@react-three/fiber";

export type DebugSample = {
  fps: number;
  x: number;
  y: number;
  z: number;
};

export function DebugSampler({
  onSample,
}: {
  onSample: (s: DebugSample) => void;
}) {
  const camera = useThree((s) => s.camera);
  const lastTime = useRef(performance.now());
  const ema = useRef(60);
  const lastEmit = useRef(0);

  useFrame(() => {
    const now = performance.now();
    const dt = now - lastTime.current;
    lastTime.current = now;
    if (dt > 0) {
      const instantaneous = 1000 / dt;
      ema.current = ema.current * 0.9 + instantaneous * 0.1;
    }
    if (now - lastEmit.current > 250) {
      lastEmit.current = now;
      onSample({
        fps: ema.current,
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      });
    }
  });

  return null;
}

export function DebugHud({ sample }: { sample: DebugSample }) {
  return (
    <div
      className="pointer-events-none absolute top-2 left-2 rounded bg-black/60 px-2 py-1 font-mono text-xs text-white"
      data-testid="debug-overlay"
    >
      <div>fps {sample.fps.toFixed(0)}</div>
      <div>
        cam {sample.x.toFixed(1)}, {sample.y.toFixed(1)}, {sample.z.toFixed(1)} m
      </div>
    </div>
  );
}
