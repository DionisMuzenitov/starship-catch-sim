/**
 * Rendering quality tiers + the perf-HUD toggle (SLS-61).
 *
 * The scene is geometrically light (one vehicle + terrain + tower), so on a
 * hi-dpi display the dominant cost is the number of PIXELS shaded — i.e. the
 * renderer pixel ratio (`dpr`). That is the single tier lever: `<QualityController>`
 * applies it at runtime, clamped to the device ratio. (The full-screen post
 * passes — Bloom + SMAA — run on every tier; their cost already scales with the
 * pixel count, so `dpr` moves them too, and antialiasing is never dropped.)
 *
 * Tier + perf-HUD choices are persisted to localStorage.
 */

import { create } from "zustand";

export type QualityTier = "low" | "medium" | "high";

export type TierConfig = {
  /** Renderer pixel-ratio cap — the tier lever. Clamped to the device ratio at
   *  apply time (no point shading above native). */
  readonly dpr: number;
};

export const TIERS: Record<QualityTier, TierConfig> = {
  low: { dpr: 1 },
  medium: { dpr: 1.5 },
  high: { dpr: 2 },
};

/** Tier list for the picker, derived from `TIERS` so there is one source. */
export const QUALITY_TIERS = Object.keys(TIERS) as QualityTier[];

const TIER_KEY = "sls.qualityTier";
const PERF_KEY = "sls.perfHud";

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore persistence failures (private mode / no localStorage) */
  }
}

function loadTier(): QualityTier {
  const v = readLS(TIER_KEY);
  return v === "low" || v === "medium" || v === "high" ? v : "medium";
}
function loadPerfHud(): boolean {
  // Default ON (owner preference — fps is a feature on a technical demo); a
  // persisted "false" (unchecked for a capture) is remembered.
  return readLS(PERF_KEY) !== "false";
}

export type QualityState = {
  tier: QualityTier;
  setTier: (tier: QualityTier) => void;
  /** Whether the frame-time perf HUD is shown. Default ON; uncheck for a clean
   *  marketing capture (SLS-64). Persisted. */
  perfHud: boolean;
  togglePerfHud: () => void;
};

export const useQualityStore = create<QualityState>((set) => ({
  tier: loadTier(),
  setTier: (tier) => {
    writeLS(TIER_KEY, tier);
    set({ tier });
  },
  perfHud: loadPerfHud(),
  togglePerfHud: () =>
    set((s) => {
      const perfHud = !s.perfHud;
      writeLS(PERF_KEY, String(perfHud));
      return { perfHud };
    }),
}));
