/**
 * Debug overlay toggles. Currently houses the drag-trajectory overlay
 * flag (SLS-21); more debug surfaces may join later.
 */

import { create } from "zustand";

export type DebugState = {
  traceVisible: boolean;
  toggleTrace: () => void;
};

export const useDebugStore = create<DebugState>((set) => ({
  traceVisible: false,
  toggleTrace: () => set((s) => ({ traceVisible: !s.traceVisible })),
}));
