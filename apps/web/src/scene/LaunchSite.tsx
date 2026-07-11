/**
 * Launch-site dressing around the tower (SLS-57, ADR-018): orbital launch
 * mount, tank farm and concrete apron, placed per the sourced site layout in
 * docs/reference/starbase-site.md (Pad A 2024–25 catch era). All positions
 * are scenery — the physics tower/capture constants remain canonical.
 *
 * Frame: origin = tower base, +X = east (rocket/chopstick side), -Z = north
 * (Hwy 4 / tank-farm side), metres.
 */
import { useEffect, useRef } from "react";

import { MeshStandardMaterial } from "three";

import { type MechazillaApi, MechazillaTower } from "./MechazillaTower";

// tower → OLM offset ~25–30 m (derived estimate, starbase-site.md)
const OLM_POS_X = 28;
const OLM_DECK_HEIGHT_M = 18;
const OLM_RING_RADIUS_M = 7.5;
const OLM_LEG_COUNT = 6;

const steelMat = new MeshStandardMaterial({
  color: "#4c5158",
  metalness: 0.45,
  roughness: 0.6,
});
const concreteMat = new MeshStandardMaterial({
  color: "#9b9a8f",
  metalness: 0.0,
  roughness: 0.95,
});
const tankMat = new MeshStandardMaterial({
  color: "#d8d5cd",
  metalness: 0.35,
  roughness: 0.45,
});
const waterTankMat = new MeshStandardMaterial({
  color: "#8f9aa4",
  metalness: 0.3,
  roughness: 0.55,
});

/** Orbital launch mount: ring on six legs (~20 m, Pad A era). */
function Olm() {
  const legs = Array.from({ length: OLM_LEG_COUNT }, (_, i) => {
    const a = (i / OLM_LEG_COUNT) * Math.PI * 2;
    return [Math.cos(a) * OLM_RING_RADIUS_M, Math.sin(a) * OLM_RING_RADIUS_M] as const;
  });
  return (
    <group position={[OLM_POS_X, 0, 0]}>
      {legs.map(([lx, lz], i) => (
        <mesh key={`olm-leg-${i}`} position={[lx, OLM_DECK_HEIGHT_M / 2, lz]} material={concreteMat}>
          <cylinderGeometry args={[1.2, 1.4, OLM_DECK_HEIGHT_M, 10]} />
        </mesh>
      ))}
      {/* launch ring */}
      <mesh
        position={[0, OLM_DECK_HEIGHT_M + 1, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={steelMat}
      >
        <torusGeometry args={[OLM_RING_RADIUS_M, 2.6, 12, 32]} />
      </mesh>
      {/* deck plate */}
      <mesh position={[0, OLM_DECK_HEIGHT_M + 2.8, 0]} material={steelMat}>
        <cylinderGeometry args={[OLM_RING_RADIUS_M + 2.6, OLM_RING_RADIUS_M + 2.6, 0.8, 24]} />
      </mesh>
    </group>
  );
}

/** OLS tank farm: a row along the north side (Hwy 4), NE of the tower
 *  stretching west — CH₄ / LOX / LN₂ / water groups (starbase-site.md). */
function TankFarm() {
  const tanks: Array<{ x: number; z: number; r: number; h: number; water?: boolean }> = [];
  // CH4 + LOX + LN2: 14 vertical cryo tanks marching west along the row
  for (let i = 0; i < 14; i++) {
    tanks.push({ x: 40 - i * 22, z: -135 - (i % 2) * 9, r: 2.6, h: 24 });
  }
  // deluge/water tanks at the west end
  for (let i = 0; i < 3; i++) {
    tanks.push({ x: -300 - i * 16, z: -140, r: 4.2, h: 13, water: true });
  }
  return (
    <group>
      {tanks.map((t, i) => (
        <mesh
          key={`tank-${i}`}
          position={[t.x, t.h / 2, t.z]}
          material={t.water ? waterTankMat : tankMat}
        >
          <cylinderGeometry args={[t.r, t.r, t.h, 14]} />
        </mesh>
      ))}
    </group>
  );
}

/** Concrete apron under the tower/OLM area. */
function Apron() {
  return (
    <mesh position={[14, 0.12, 0]} material={concreteMat}>
      <cylinderGeometry args={[60, 60, 0.24, 40]} />
    </mesh>
  );
}

/**
 * The full catch-site: physics-parameterised Mechazilla tower (arms open,
 * awaiting the booster) + OLM + tank farm + apron.
 */
export function LaunchSite() {
  const towerRef = useRef<MechazillaApi>(null);
  useEffect(() => {
    // pre-catch stance: chopsticks open, carriage at the default catch height
    towerRef.current?.setOpening(1);
  }, []);
  return (
    <group>
      <MechazillaTower ref={towerRef} />
      <Olm />
      <TankFarm />
      <Apron />
    </group>
  );
}
