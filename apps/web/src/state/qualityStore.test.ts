import { afterEach, describe, expect, it } from "vitest";

import { QUALITY_TIERS, TIERS, useQualityStore } from "./qualityStore";

describe("qualityStore (SLS-61)", () => {
  // Restore the singleton store after each test (it persists across the suite).
  const initial = { ...useQualityStore.getState() };
  afterEach(() => {
    useQualityStore.setState({ tier: initial.tier, perfHud: initial.perfHud });
  });

  it("tiers escalate cost: dpr is strictly increasing low → medium → high", () => {
    expect(TIERS.low.dpr).toBeLessThan(TIERS.medium.dpr);
    expect(TIERS.medium.dpr).toBeLessThan(TIERS.high.dpr);
  });

  it("QUALITY_TIERS is derived from TIERS (single source) and every tier has a positive dpr", () => {
    expect(QUALITY_TIERS).toEqual(Object.keys(TIERS));
    for (const t of QUALITY_TIERS) {
      expect(TIERS[t].dpr).toBeGreaterThan(0);
    }
  });

  it("setTier updates the store; togglePerfHud flips the flag", () => {
    useQualityStore.getState().setTier("high");
    expect(useQualityStore.getState().tier).toBe("high");
    const before = useQualityStore.getState().perfHud;
    useQualityStore.getState().togglePerfHud();
    expect(useQualityStore.getState().perfHud).toBe(!before);
  });
});
