/**
 * MPC predicted-trajectory overlay (SLS-26).
 *
 * Draws the latest plan from the MPC service as a fading polyline: bright
 * emerald near the vehicle's current plan position, transparent toward
 * touchdown. Mounted only while the MPC controller is active; drei's
 * `<Line>` handles the vertex-colour gradient.
 */

import { Line } from "@react-three/drei";

import { useControllerStore } from "../../state/controllerStore.js";
import { useMpcStore } from "../../state/mpcStore.js";

export function MpcPlanOverlay() {
  const kind = useControllerStore((s) => s.kind);
  const plan = useMpcStore((s) => s.plan);
  if (kind !== "mpc" || plan === null || plan.positions.length < 2) {
    return null;
  }
  const points = plan.positions.map(
    (p) => [p.x, p.y, p.z] as [number, number, number],
  );
  // Fade from opaque at the plan head to near-invisible at touchdown.
  const colors = plan.positions.map((_, i) => {
    const t = i / (plan.positions.length - 1);
    const fade = 1 - 0.85 * t;
    return [0.2 * fade, 0.9 * fade, 0.6 * fade] as [number, number, number];
  });
  return (
    <Line
      points={points}
      vertexColors={colors}
      lineWidth={2}
      transparent
      opacity={0.85}
      depthTest={false}
    />
  );
}
