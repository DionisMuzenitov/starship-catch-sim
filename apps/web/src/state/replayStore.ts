/**
 * Replay-player state. When `mode === 'replay'`, the live sim runner is
 * forced-paused and a `ReplayDriver` component takes over `simStore.world`
 * each frame by interpolating into `activeReplay` at `playbackT`. When
 * `mode === 'live'` the runner drives the scene normally.
 *
 * The reset/exit-to-live path is handled by `<App>`: bumping
 * `scenarioStore.epoch` re-mounts `<Scene>`, which tears down the replay
 * driver and the runner reinitialises against the active scenario.
 */

import type { Replay } from "@starship-catch-sim/physics";
import { create } from "zustand";

export type ReplayMode = "live" | "replay";

export type ReplaySpeed = 0.25 | 1 | 4;

export const REPLAY_SPEEDS: readonly ReplaySpeed[] = [0.25, 1, 4];

export type ReplayState = {
  mode: ReplayMode;
  activeReplay: Replay | null;
  /** Sim time of the scrub head within `activeReplay`'s timeline (s). */
  playbackT: number;
  playbackSpeed: ReplaySpeed;
  playing: boolean;
  enterReplay: (replay: Replay) => void;
  exitReplay: () => void;
  setPlaybackT: (t: number) => void;
  setPlaybackSpeed: (speed: ReplaySpeed) => void;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
};

export const useReplayStore = create<ReplayState>((set) => ({
  mode: "live",
  activeReplay: null,
  playbackT: 0,
  playbackSpeed: 1,
  playing: true,
  enterReplay: (replay) => {
    const firstT = replay.frames[0]?.t ?? 0;
    set({
      mode: "replay",
      activeReplay: replay,
      playbackT: firstT,
      playbackSpeed: 1,
      playing: true,
    });
  },
  exitReplay: () =>
    set({
      mode: "live",
      activeReplay: null,
      playbackT: 0,
      playbackSpeed: 1,
      playing: true,
    }),
  setPlaybackT: (playbackT) => set({ playbackT }),
  setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),
  setPlaying: (playing) => set({ playing }),
  togglePlaying: () => set((s) => ({ playing: !s.playing })),
}));
