import { useRef } from "react";

import { useFrame } from "@react-three/fiber";
import type { Surface, SurfaceState } from "@starship-catch-sim/physics";
import type { Group } from "three";

import { getFinMaterial } from "./materials";

type Props = {
  surface: Surface;
  state: SurfaceState;
  /** Body radius in metres — fin attaches just outside this. */
  bodyRadius: number;
};

const FIN_CHORD = 2.5; // m — along body (vertical) axis
const FIN_SPAN = 2.2; // m — radially outward
const FIN_THICKNESS = 0.15; // m

/**
 * Grid fin near the top of the booster. Hinged on body +Y so the fin pitches
 * forward/aft in the local horizontal plane around its mount.
 */
export function GridFin({ surface, state, bodyRadius }: Props) {
  const hingeRef = useRef<Group>(null);

  // Tangential angle of the mount on the body, in body XZ plane.
  // The fin should point radially outward from this angle.
  const mountAngle = Math.atan2(
    surface.zeroDeflectionNormalBody.z,
    surface.zeroDeflectionNormalBody.x,
  );
  // Mount sits on the body cylinder.
  const mx = bodyRadius * Math.cos(mountAngle);
  const mz = bodyRadius * Math.sin(mountAngle);
  const my = surface.mount.y;

  useFrame(() => {
    if (!hingeRef.current) return;
    // Hinge axis is body +Y. The fin's "outward" direction rotates about
    // body +Y by `deflection`. Apply to the inner hinge group; the fin
    // geometry lives further out and inherits the rotation.
    hingeRef.current.rotation.y = state.deflection;
  });

  return (
    <group position={[mx, my, mz]} rotation={[0, mountAngle, 0]}>
      <group ref={hingeRef}>
        {/* Fin centred FIN_SPAN/2 outward from the body surface, with the
            long axis (chord) parallel to body Y. */}
        <mesh
          position={[FIN_SPAN / 2, 0, 0]}
          material={getFinMaterial()}
        >
          <boxGeometry args={[FIN_SPAN, FIN_CHORD, FIN_THICKNESS]} />
        </mesh>
      </group>
    </group>
  );
}
