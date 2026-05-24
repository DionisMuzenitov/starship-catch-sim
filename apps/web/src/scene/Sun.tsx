import { SUN_COLOR } from "./constants";

const SUN_DISTANCE_M = 2000;

export function Sun() {
  // Sun at a fixed mid-morning angle (azimuth ~135°, elevation ~45°).
  const az = (135 * Math.PI) / 180;
  const el = (45 * Math.PI) / 180;
  const x = SUN_DISTANCE_M * Math.cos(el) * Math.sin(az);
  const y = SUN_DISTANCE_M * Math.sin(el);
  const z = SUN_DISTANCE_M * Math.cos(el) * Math.cos(az);

  return (
    <>
      <ambientLight intensity={0.35} color="#cfd8e3" />
      <directionalLight
        position={[x, y, z]}
        intensity={1.4}
        color={SUN_COLOR}
      />
    </>
  );
}
