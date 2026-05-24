import { useRef } from "react";

import { useFrame } from "@react-three/fiber";
import type { Surface, SurfaceState } from "@starship-catch-sim/physics";
import type { Group } from "three";

import { getFinMaterial } from "./materials";

type Props = {
  surface: Surface;
  state: SurfaceState;
  bodyRadius: number;
};

const FLAP_CHORD = 5.5; // m — along body axis
const FLAP_SPAN = 4.5; // m — radially outward
const FLAP_THICKNESS = 0.25; // m

/**
 * Articulated flap — bigger panel than a grid fin, swings through a wider
 * arc. Same hinge convention (body +Y).
 */
export function Flap({ surface, state, bodyRadius }: Props) {
  const hingeRef = useRef<Group>(null);

  const mountAngle = Math.atan2(
    surface.zeroDeflectionNormalBody.z,
    surface.zeroDeflectionNormalBody.x,
  );
  const mx = bodyRadius * Math.cos(mountAngle);
  const mz = bodyRadius * Math.sin(mountAngle);
  const my = surface.mount.y;

  useFrame(() => {
    if (!hingeRef.current) return;
    hingeRef.current.rotation.y = state.deflection;
  });

  // See SLS-39: Y-rotation sign matches the math convention used in
  // mountAngle (atan2) only when negated, because Three.js Y-up rotation
  // about +Y sends +X → −Z, not +Z. Current flap mounts are on ±X so the
  // sign doesn't matter today, but matching GridFin keeps the convention
  // consistent and prevents the same bug if Z-mounted flaps are added.
  return (
    <group position={[mx, my, mz]} rotation={[0, -mountAngle, 0]}>
      <group ref={hingeRef}>
        <mesh
          position={[FLAP_SPAN / 2, 0, 0]}
          material={getFinMaterial()}
        >
          <boxGeometry args={[FLAP_SPAN, FLAP_CHORD, FLAP_THICKNESS]} />
        </mesh>
      </group>
    </group>
  );
}
