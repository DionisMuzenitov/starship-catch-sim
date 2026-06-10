/**
 * Centre-screen reticle marking the ballistic + drag impact point of
 * the booster if all engines stayed off. Rendered via drei's `<Html>`
 * positioned at the world-frame impact point so it always tracks the
 * scene through camera moves.
 *
 * Recomputes at ~5 Hz (every 200 ms) to keep the simStep forward roll
 * cost bounded. See `predictedImpact` for the inner loop.
 */

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef, useState } from "react";

import {
  BoosterVehicle,
  type Vec3,
} from "@starship-catch-sim/physics";

import { useHudStore } from "../state/hudStore";
import { useSimStore } from "../state/simStore";

import { predictedImpact } from "./physicsDerived";

const RECOMPUTE_S = 0.2;

export function ImpactReticle() {
  const hudMode = useHudStore((s) => s.mode);
  const [impact, setImpact] = useState<Vec3 | null>(null);
  const accumRef = useRef(0);
  useFrame((_, dt) => {
    accumRef.current += dt;
    if (accumRef.current < RECOMPUTE_S) return;
    accumRef.current = 0;
    const world = useSimStore.getState().world;
    setImpact(predictedImpact(world, BoosterVehicle));
  });
  if (hudMode === "off") return null;
  if (!impact) return null;
  return (
    <Html
      position={[impact.x, impact.y + 1, impact.z]}
      center
      style={{ pointerEvents: "none" }}
    >
      <div data-testid="hud-impact-reticle">
        <svg width="44" height="44" viewBox="0 0 44 44">
          <g fill="none" stroke="rgba(255,210,80,0.85)" strokeWidth="1.2">
            <circle cx="22" cy="22" r="14" />
            <line x1="22" y1="2" x2="22" y2="12" />
            <line x1="22" y1="32" x2="22" y2="42" />
            <line x1="2" y1="22" x2="12" y2="22" />
            <line x1="32" y1="22" x2="42" y2="22" />
          </g>
        </svg>
      </div>
    </Html>
  );
}
