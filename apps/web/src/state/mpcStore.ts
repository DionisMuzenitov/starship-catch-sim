/**
 * MPC plan state for the UI: the latest predicted trajectory (drawn by
 * <PredictedTrajectory>) and whether the MPC is currently steering or has
 * dropped to its PID fallback (surfaced as a HUD badge).
 */

import { create } from "zustand";

import type { MPCPlan } from "@starship-catch-sim/controllers";

export type MPCState = {
  plan: MPCPlan | null;
  /**
   * True while the PID fallback is flying rather than the MPC plan — i.e. the
   * live "am I actually steering with MPC right now?" signal, pushed by the
   * controller's fallback observer on every transition (SLS-92). Legitimately
   * true for the ~1 s before the first solve lands and during a
   * divergence-abort even with a healthy service, so it is a live steering
   * indicator, NOT a service-health proxy (that is `serviceDisabled` /
   * `serviceUnreachable`).
   */
  usingFallback: boolean;
  /**
   * True when MPC is selected but the guidance service is declared absent
   * (static-host build, `VITE_MPC_URL=""`). Drives the degradation banner;
   * the controller flies PID with no network calls (SLS-49).
   */
  serviceDisabled: boolean;
  /**
   * True when MPC is selected against a live service URL but a health-ping
   * failed — the service simply isn't running (dev without `pnpm dev:full`).
   * Distinct from `serviceDisabled` (a build-time static-host signal): this is
   * discovered at runtime. Also drives the banner (SLS-92).
   */
  serviceUnreachable: boolean;
  setPlan: (plan: MPCPlan | null) => void;
  setUsingFallback: (usingFallback: boolean) => void;
  setServiceDisabled: (serviceDisabled: boolean) => void;
  setServiceUnreachable: (serviceUnreachable: boolean) => void;
};

export const useMpcStore = create<MPCState>((set) => ({
  plan: null,
  usingFallback: true,
  serviceDisabled: false,
  serviceUnreachable: false,
  setPlan: (plan) => set({ plan }),
  setUsingFallback: (usingFallback) => set({ usingFallback }),
  setServiceDisabled: (serviceDisabled) => set({ serviceDisabled }),
  setServiceUnreachable: (serviceUnreachable) => set({ serviceUnreachable }),
}));
