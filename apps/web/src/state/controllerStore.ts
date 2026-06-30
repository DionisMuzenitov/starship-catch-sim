/**
 * Picks which controller drives the active runner — manual stick input vs.
 * the cascaded PID baseline. The store is part of the Scene re-mount key
 * (see `App.tsx`) so switching kind tears down the current runner and
 * rebuilds `useSimRunner` from scratch with the chosen controller.
 */

import { create } from "zustand";

export type ControllerKind = "manual" | "pid";

export type ControllerState = {
  kind: ControllerKind;
  setKind: (kind: ControllerKind) => void;
};

export const useControllerStore = create<ControllerState>((set) => ({
  kind: "manual",
  setKind: (kind) => set({ kind }),
}));
