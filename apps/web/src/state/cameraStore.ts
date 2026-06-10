/**
 * Camera mode + cinematic rig selection. Mutated by keyboard bindings
 * (apps/web/src/input/keyboard.ts) and read by the `CameraRig` component
 * (apps/web/src/scene/camera/CameraRig.tsx).
 *
 * Mode keys (resolved from SLS-17's number-row collision with SLS-19):
 *   C chase · T tower · G ground · O orbit (free) · N nose (onboard)
 *   M movie (cinematic) · V cycle
 */

import { create } from "zustand";

export type CameraMode =
  | "chase"
  | "tower"
  | "ground"
  | "free"
  | "onboard"
  | "cinematic";

const CYCLE_ORDER: readonly CameraMode[] = [
  "chase",
  "tower",
  "ground",
  "free",
  "onboard",
  "cinematic",
];

export type CameraState = {
  mode: CameraMode;
  setMode: (mode: CameraMode) => void;
  cycleMode: () => void;
};

export const useCameraStore = create<CameraState>((set) => ({
  mode: "chase",
  setMode: (mode) => set({ mode }),
  cycleMode: () =>
    set((s) => ({
      mode: CYCLE_ORDER[
        (CYCLE_ORDER.indexOf(s.mode) + 1) % CYCLE_ORDER.length
      ]!,
    })),
}));
