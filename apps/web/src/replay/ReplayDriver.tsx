/**
 * rAF-pumped replay player. When `replayStore.mode === 'replay'`, this
 * component:
 *
 *   1. Force-pauses the live sim runner (so manual input / scenario logic
 *      can't fight the playback head).
 *   2. Advances `replayStore.playbackT` by `realDt × playbackSpeed` each
 *      requestAnimationFrame, clamped to the recorded range.
 *   3. Writes the interpolated world to `simStore` so the existing scene +
 *      HUD render off it unchanged.
 *
 * Returns `null` in `live` mode — the live runner remains in charge.
 */

import { useEffect, useRef } from "react";

import { interpolateReplay } from "@starship-catch-sim/physics";

import { useReplayStore } from "../state/replayStore";
import { useSimStore } from "../state/simStore";

export function ReplayDriver() {
  const mode = useReplayStore((s) => s.mode);
  // Refs reflect the latest store values so the rAF callback doesn't
  // capture stale closures on play/pause/speed/scrub.
  const replayRef = useRef(useReplayStore.getState().activeReplay);
  const playingRef = useRef(useReplayStore.getState().playing);
  const speedRef = useRef<number>(useReplayStore.getState().playbackSpeed);
  const tRef = useRef(useReplayStore.getState().playbackT);

  useEffect(() => {
    const unsub = useReplayStore.subscribe((s) => {
      replayRef.current = s.activeReplay;
      playingRef.current = s.playing;
      speedRef.current = s.playbackSpeed;
      tRef.current = s.playbackT;
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (mode !== "replay") return;
    // Stop the live runner from running its own loop in the background.
    useSimStore.getState().setPaused(true);

    const replay = replayRef.current;
    if (replay === null) return;
    const firstT = replay.frames[0]!.t;
    const lastT = replay.frames[replay.frames.length - 1]!.t;
    let lastWall: number | null = null;
    let raf = 0;

    // Render the starting frame synchronously so the scene reflects the
    // replay on the first paint — before the first rAF tick lands.
    const seed = interpolateReplay(replay, tRef.current);
    useSimStore.getState().setWorld(seed.world);

    const tick = (wallMs: number) => {
      if (lastWall === null) lastWall = wallMs;
      const realDt = Math.min(0.1, (wallMs - lastWall) / 1000);
      lastWall = wallMs;
      if (playingRef.current) {
        let next = tRef.current + realDt * speedRef.current;
        if (next >= lastT) {
          next = lastT;
          // Freeze on the outcome frame; user can still scrub or rewind.
          useReplayStore.getState().setPlaying(false);
        } else if (next < firstT) {
          next = firstT;
        }
        useReplayStore.getState().setPlaybackT(next);
        tRef.current = next;
      }
      const sample = interpolateReplay(replay, tRef.current);
      useSimStore.getState().setWorld(sample.world);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [mode]);

  return null;
}
