/**
 * MPC plan state for the UI: the latest predicted trajectory (drawn by
 * <PredictedTrajectory>) and whether the MPC is currently steering or has
 * dropped to its PID fallback (surfaced as a HUD badge).
 */

import { create } from "zustand";

import type { MPCPlan } from "@starship-catch-sim/controllers";

export type MPCState = {
  plan: MPCPlan | null;
  usingFallback: boolean;
  setPlan: (plan: MPCPlan | null) => void;
  setUsingFallback: (usingFallback: boolean) => void;
};

export const useMpcStore = create<MPCState>((set) => ({
  plan: null,
  usingFallback: true,
  setPlan: (plan) => set({ plan }),
  setUsingFallback: (usingFallback) => set({ usingFallback }),
}));
