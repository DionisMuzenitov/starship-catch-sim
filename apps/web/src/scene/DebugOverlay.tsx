import { useRef } from "react";

import { useFrame, useThree } from "@react-three/fiber";

export type DebugSample = {
  fps: number;
  /** Average frame time over the last emit window (ms). */
  ms: number;
  /** Worst (longest) frame time over the last emit window (ms) — the number
   *  that matters for judder; a good average can still hide hitches. */
  worstMs: number;
  x: number;
  y: number;
  z: number;
};

const EMIT_INTERVAL_MS = 250;

/**
 * Samples frame time into a `DebugSample` a few times a second (SLS-61). fps is
 * a smoothed EMA; ms is the average + worst frame time over each emit window, so
 * the perf HUD shows both the headline rate and the hitches an average hides.
 */
export function DebugSampler({
  onSample,
}: {
  onSample: (s: DebugSample) => void;
}) {
  const camera = useThree((s) => s.camera);
  const lastTime = useRef(performance.now());
  const ema = useRef(60);
  // Seed to now so the first emit waits a full window (not a mount-latency spike).
  const lastEmit = useRef(performance.now());
  // Window accumulators, reset each emit.
  const sumMs = useRef(0);
  const worstMs = useRef(0);
  const frames = useRef(0);

  useFrame(() => {
    const now = performance.now();
    const dt = now - lastTime.current;
    lastTime.current = now;
    if (dt > 0) {
      ema.current = ema.current * 0.9 + (1000 / dt) * 0.1;
      sumMs.current += dt;
      if (dt > worstMs.current) worstMs.current = dt;
      frames.current += 1;
    }
    if (now - lastEmit.current > EMIT_INTERVAL_MS) {
      lastEmit.current = now;
      onSample({
        fps: ema.current,
        ms: frames.current > 0 ? sumMs.current / frames.current : 0,
        worstMs: worstMs.current,
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      });
      sumMs.current = 0;
      worstMs.current = 0;
      frames.current = 0;
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
      <div>
        fps {sample.fps.toFixed(0)} · {sample.ms.toFixed(1)} ms
        <span className="opacity-60"> (worst {sample.worstMs.toFixed(1)})</span>
      </div>
      <div>
        cam {sample.x.toFixed(1)}, {sample.y.toFixed(1)}, {sample.z.toFixed(1)} m
      </div>
    </div>
  );
}
