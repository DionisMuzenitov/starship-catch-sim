/**
 * Debug wireframes for the chopstick segment-chain collider (SLS-84), shown in
 * `?tune=1`. Reads the world-space boxes the tower reports each frame (the same
 * ones the sim collides against) and draws them, so you can confirm the chain
 * rides the arms as they move. Rendered at the top scene level — the boxes are
 * in the booster's world frame, not the SITE_OFFSET group.
 */
import { useRef } from "react";

import { useFrame } from "@react-three/fiber";
import type { Group } from "three";

import { ARM_SEGMENTS, getArmSegmentBoxes } from "../sim/siteCollision";

const MAX_BOXES = ARM_SEGMENTS * 2;

export function ArmSegmentsDebug(): React.JSX.Element {
  const groupRef = useRef<Group>(null);
  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const boxes = getArmSegmentBoxes();
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
  });
  return (
    <group ref={groupRef}>
      {Array.from({ length: MAX_BOXES }, (_, i) => (
        <mesh key={i} visible={false}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color={i % 2 === 0 ? "#ff3b30" : "#ffcc00"}
            wireframe
            transparent
            opacity={0.7}
          />
        </mesh>
      ))}
    </group>
  );
}
