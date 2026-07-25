/**
 * Applies the selected quality tier's renderer pixel ratio at runtime (SLS-61).
 * Lives inside the `<Canvas>` so it can call R3F's `setDpr`; the dpr is clamped
 * to the device ratio (shading above native is wasted work). Renders nothing.
 */

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";

import { TIERS, useQualityStore } from "../state/qualityStore";

export function QualityController() {
  const tier = useQualityStore((s) => s.tier);
  const setDpr = useThree((s) => s.setDpr);

  useEffect(() => {
    const apply = () => setDpr(Math.min(TIERS[tier].dpr, window.devicePixelRatio || 1));
    apply();
    // Re-apply if the device ratio changes (window moved to a monitor with a
    // different DPI), which surfaces as a resize.
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [tier, setDpr]);

  return null;
}
