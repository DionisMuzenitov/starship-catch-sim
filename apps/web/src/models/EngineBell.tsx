import { useMemo, useRef } from "react";

import { useFrame } from "@react-three/fiber";
import type { EngineState } from "@starship-catch-sim/physics";
import { CylinderGeometry, type Group } from "three";

import { getEngineMaterial } from "./materials";

type Props = {
  mountX: number;
  mountZ: number;
  state: EngineState;
  /** Bell exit-plane radius (m). */
  exitRadius: number;
  /** Throat radius (m). */
  throatRadius: number;
  /** Bell length, mount-to-exit (m). */
  length: number;
};

/**
 * Engine bell at one mount point. The bell hangs below the engine plane
 * (y < 0 in body frame) and tilts with the realised gimbal angles.
 */
export function EngineBell({
  mountX,
  mountZ,
  state,
  exitRadius,
  throatRadius,
  length,
}: Props) {
  const ref = useRef<Group>(null);

  const geometry = useMemo(
    () => new CylinderGeometry(throatRadius, exitRadius, length, 16, 1, true),
    [throatRadius, exitRadius, length],
  );

  useFrame(() => {
    if (!ref.current) return;
    // Pitch about body X, yaw about body Z. Matches `gimbalDirection` in
    // packages/physics/src/thrust.ts:156-161.
    ref.current.rotation.x = state.gimbalPitch;
    ref.current.rotation.z = state.gimbalYaw;
  });

  return (
    <group position={[mountX, 0, mountZ]} ref={ref}>
      <mesh
        position={[0, -length / 2, 0]}
        geometry={geometry}
        material={getEngineMaterial()}
      />
    </group>
  );
}
