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
  /**
   * True when MPC is selected but the guidance service is declared absent
   * (static-host build, `VITE_MPC_URL=""`). Drives the degradation banner;
   * the controller flies PID with no network calls (SLS-49).
   */
  serviceDisabled: boolean;
  setPlan: (plan: MPCPlan | null) => void;
  setUsingFallback: (usingFallback: boolean) => void;
  setServiceDisabled: (serviceDisabled: boolean) => void;
};

export const useMpcStore = create<MPCState>((set) => ({
  plan: null,
  usingFallback: true,
  serviceDisabled: false,
  setPlan: (plan) => set({ plan }),
  setUsingFallback: (usingFallback) => set({ usingFallback }),
  setServiceDisabled: (serviceDisabled) => set({ serviceDisabled }),
}));
