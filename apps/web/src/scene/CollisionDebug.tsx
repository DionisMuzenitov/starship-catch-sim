/**
 * Collision-geometry debug overlay (SLS-84 / ADR-020), shown in `?tune=1`.
 * Draws every shape the sim actually collides against, colour-coded:
 *   cyan   — bulk structures (tower column, OLM), CoM-point tested
 *   red/yellow — chopstick arm segment boxes, capsule tested
 *   green  — the booster collision capsule (rotates with attitude)
 * All are read live each frame (the same data `evaluateCatchOutcome` uses), so
 * they ride the arms and the booster as things move.
 */
import { useRef } from "react";

import { useFrame } from "@react-three/fiber";
import { BOOSTER_CAPSULE, scenarioById } from "@starship-catch-sim/physics";
import type { Group } from "three";

import { ARM_SEGMENTS, drawnSiteCollision } from "../sim/siteCollision";
import { useScenarioStore } from "../state/scenarioStore";
import { useSimStore } from "../state/simStore";

const MAX_STRUCT = 4;
const MAX_ARMS = 2 * ARM_SEGMENTS;

export function CollisionDebug(): React.JSX.Element {
  const scenarioId = useScenarioStore((s) => s.currentScenarioId);
  const cap = scenarioById(scenarioId)?.collisionBody ?? BOOSTER_CAPSULE;

  const structRef = useRef<Group>(null);
  const armsRef = useRef<Group>(null);
  const capsuleRef = useRef<Group>(null);

  useFrame(() => {
    const site = drawnSiteCollision();
    const paint = (g: Group | null, boxes: readonly { center: { x: number; y: number; z: number }; halfExtents: { x: number; y: number; z: number } }[]) => {
      if (!g) return;
      g.children.forEach((child, i) => {
        const b = boxes[i];
        if (b) {
          child.visible = true;
          child.position.set(b.center.x, b.center.y, b.center.z);
          child.scale.set(b.halfExtents.x * 2, b.halfExtents.y * 2, b.halfExtents.z * 2);
        } else {
          child.visible = false;
        }
      });
    };
    paint(structRef.current, site.solids);
    paint(armsRef.current, site.armSolids ?? []);

    const g = capsuleRef.current;
    if (g) {
      const rb = useSimStore.getState().world.rigidBody;
      g.position.set(rb.position.x, rb.position.y, rb.position.z);
      g.quaternion.set(rb.attitude.x, rb.attitude.y, rb.attitude.z, rb.attitude.w);
    }
  });

  return (
    <>
      <group ref={structRef}>
        {Array.from({ length: MAX_STRUCT }, (_, i) => (
          <mesh key={i} visible={false}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial color="#33ddff" wireframe transparent opacity={0.5} />
          </mesh>
        ))}
      </group>
      <group ref={armsRef}>
        {Array.from({ length: MAX_ARMS }, (_, i) => (
          <mesh key={i} visible={false}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial color={i % 2 === 0 ? "#ff3b30" : "#ffcc00"} wireframe transparent opacity={0.8} />
          </mesh>
        ))}
      </group>
      {/* booster capsule: group carries the CoM pose (position + attitude); the
          inner mesh is offset along body +Y by cap.offset (model origin ≠ CoM) */}
      <group ref={capsuleRef}>
        <mesh position={[0, cap.offset, 0]}>
          <capsuleGeometry args={[cap.radius, cap.halfLength * 2, 6, 16]} />
          <meshBasicMaterial color="#22ff88" wireframe transparent opacity={0.6} />
        </mesh>
      </group>
    </>
  );
}
