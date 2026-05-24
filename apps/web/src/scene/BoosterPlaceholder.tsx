import { BOOSTER_HEIGHT_M, BOOSTER_RADIUS_M } from "./constants";

export function BoosterPlaceholder() {
  return (
    <mesh position={[0, BOOSTER_HEIGHT_M / 2, 0]} castShadow>
      <cylinderGeometry
        args={[BOOSTER_RADIUS_M, BOOSTER_RADIUS_M, BOOSTER_HEIGHT_M, 24]}
      />
      <meshStandardMaterial color="#cdd2d8" metalness={0.4} roughness={0.5} />
    </mesh>
  );
}
