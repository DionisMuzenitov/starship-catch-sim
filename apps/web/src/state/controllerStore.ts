/**
 * Picks which controller drives the active runner and how manual takeover
 * behaves when an auto-fly mode is selected.
 *
 *  - `kind` selects the primary controller (Manual / PID / MPC / RL).
 *    MPC and RL are stubbed out until their tickets land.
 *  - `overrideMode` decides what happens when the player grabs the stick
 *    during an auto-fly run: "temporary" hands control back after a 2-s
 *    quiet window, "hard" pins control to the manual driver until the
 *    user flips back. Manual mode ignores `overrideMode` entirely.
 *  - `overrideActive` is set by the runner's override layer so the HUD
 *    can show a flash when the player is in control.
 *
 * `kind` is part of the Scene re-mount key (see `App.tsx`) so swapping
 * primary controllers rebuilds the runner cleanly.
 */

import { create } from "zustand";

export type ControllerKind = "manual" | "pid" | "mpc" | "rl";
export type OverrideMode = "temporary" | "hard";

export type ControllerState = {
  kind: ControllerKind;
  overrideMode: OverrideMode;
  overrideActive: boolean;
  setKind: (kind: ControllerKind) => void;
  setOverrideMode: (mode: OverrideMode) => void;
  setOverrideActive: (active: boolean) => void;
};

export const useControllerStore = create<ControllerState>((set) => ({
  kind: "manual",
  overrideMode: "temporary",
  overrideActive: false,
  setKind: (kind) => set({ kind }),
  setOverrideMode: (overrideMode) => set({ overrideMode }),
  setOverrideActive: (overrideActive) => set({ overrideActive }),
}));

/**
 * Sentinel for controllers that are slotted in the UI but not yet built —
 * `ControllerSwitcher` renders these disabled with a "(soon)" suffix. Empty
 * today, but kept (not deleted) on purpose: SLS-96 reuses this machinery to
 * grey out invalid vehicle×controller combos (e.g. ship × RL) for the launch
 * guard. Removing it now would only make SLS-96 rebuild it.
 */
export const PLACEHOLDER_KINDS: ControllerKind[] = [];
