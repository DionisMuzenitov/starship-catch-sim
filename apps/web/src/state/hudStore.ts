/**
 * HUD presentation state — mode (full/minimal/off) and unit system
 * (metric/imperial). Mutated by keyboard bindings; read by the HUD
 * components.
 */

import { create } from "zustand";

export type HudMode = "full" | "minimal" | "off";
export type Units = "metric" | "imperial";

const MODE_CYCLE: readonly HudMode[] = ["full", "minimal", "off"];

export type HudState = {
  mode: HudMode;
  units: Units;
  cycleMode: () => void;
  setMode: (mode: HudMode) => void;
  toggleUnits: () => void;
};

export const useHudStore = create<HudState>((set) => ({
  mode: "full",
  units: "metric",
  cycleMode: () =>
    set((s) => ({
      mode: MODE_CYCLE[(MODE_CYCLE.indexOf(s.mode) + 1) % MODE_CYCLE.length]!,
    })),
  setMode: (mode) => set({ mode }),
  toggleUnits: () =>
    set((s) => ({ units: s.units === "metric" ? "imperial" : "metric" })),
}));
