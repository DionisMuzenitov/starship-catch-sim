import { useRef } from "react";

import { useFrame } from "@react-three/fiber";
import { type FogExp2 } from "three";

import { FOG_DENSITY, HORIZON_COLOR } from "./constants";

/** Atmospheric density scale height — fog thins as the camera climbs so the
 *  baked terrain stays visible from high altitude (SLS-57). */
const FOG_SCALE_HEIGHT_M = 8_000;

export function Fog() {
  const ref = useRef<FogExp2>(null);
  useFrame(({ camera }) => {
    if (!ref.current) return;
    const y = Math.max(0, camera.position.y);
    ref.current.density = FOG_DENSITY * Math.exp(-y / FOG_SCALE_HEIGHT_M);
  });
  return <fogExp2 ref={ref} attach="fog" args={[HORIZON_COLOR, FOG_DENSITY]} />;
}
