/**
 * Launch-site dressing around the tower (SLS-57, ADR-018): orbital launch
 * mount, tank farms and concrete apron. Positions and heights are MEASURED
 * from the CC0 2023 USGS Lower Rio Grande lidar (30 pts/m² point cloud,
 * structures extracted at 0.25 m — see docs/reference/starbase-site.md).
 * All of this is scenery — the physics tower/capture constants remain
 * canonical.
 *
 * Frame: origin = tower base, +X = east (rocket/chopstick side), -Z = north
 * (Hwy 4 side), metres.
 */
import { Component, type ReactNode, Suspense, useCallback, useRef } from "react";

import { MeshStandardMaterial } from "three";

import { type MechazillaApi, MechazillaTower } from "./MechazillaTower";
import { MechazillaTowerGLB } from "./MechazillaTowerGLB";
import {
  OLM_DECK_HEIGHT_M,
  OLM_POS_X,
  OLM_POS_Z,
  OLM_RING_RADIUS_M,
} from "./siteLayout";
import { useTowerTuneStore } from "../state/towerTuneStore";

/** The community GLB tower (SLS-76) is the default; `?tower=proc` falls back
 *  to the procedural one (kept for A/B and as a loading-failure escape hatch). */
function useGlbTower(): boolean {
  if (typeof window === "undefined") return true;
  return new URLSearchParams(window.location.search).get("tower") !== "proc";
}

/** Same graceful-fallback pattern as the GLB vehicle (SLS-44 VehicleModel):
 *  if the tower GLB fails to load/decode, the procedural tower renders —
 *  the sim never white-screens over scenery. */
class TowerGlbBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

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
  // Owner-tunable placement (SLS-76 `?tower=glb&tune=1`) so the platform can be
  // squared to the tower face the same way the tower yaw was aligned.
  const olmYawDeg = useTowerTuneStore((s) => s.olmYawDeg);
  const olmDx = useTowerTuneStore((s) => s.olmDx);
  const olmDz = useTowerTuneStore((s) => s.olmDz);
  const legs = Array.from({ length: OLM_LEG_COUNT }, (_, i) => {
    const a = (i / OLM_LEG_COUNT) * Math.PI * 2;
    return [Math.cos(a) * OLM_RING_RADIUS_M, Math.sin(a) * OLM_RING_RADIUS_M] as const;
  });
  return (
    <group
      position={[OLM_POS_X + olmDx, 0, OLM_POS_Z + olmDz]}
      rotation={[0, (olmYawDeg * Math.PI) / 180, 0]}
    >
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

/** Orbital (GSE) tank farm — measured as a compact two-row block centred
 *  ~(43, -88), ~30 m tall, NNE of the tower (2023 lidar). Eight big cryo
 *  shells in two rows plus smaller service tanks on the west edge. */
function TankFarm() {
  const tanks: Array<{ x: number; z: number; r: number; h: number; water?: boolean }> = [];
  // two rows of four sleeved cryo tanks
  for (let i = 0; i < 4; i++) {
    tanks.push({ x: 20 + i * 22, z: -72, r: 4.6, h: 29 });
    tanks.push({ x: 20 + i * 22, z: -100, r: 4.6, h: 29 });
  }
  // smaller service/water tanks on the block's west side
  for (let i = 0; i < 3; i++) {
    tanks.push({ x: -2, z: -70 - i * 14, r: 2.6, h: 14, water: true });
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

/** Western support area — measured blocks at ~(-260, -140) (structural/test
 *  stands, ~33 m) and the tall mast/water tower at ~(-264, -54), ~59 m
 *  (2023 lidar). Coarse massing so the west skyline reads right. */
function WestSupportArea() {
  return (
    <group>
      <mesh position={[-262, 16, -139]} material={tankMat}>
        <boxGeometry args={[80, 32, 60]} />
      </mesh>
      <mesh position={[-252, 14, -82]} material={waterTankMat}>
        <boxGeometry args={[18, 28, 26]} />
      </mesh>
      {/* tall mast / water tower */}
      <mesh position={[-264, 27, -54]} material={waterTankMat}>
        <cylinderGeometry args={[4.5, 5.5, 54, 12]} />
      </mesh>
      {/* production row along Hwy 4 to the north-west */}
      <mesh position={[-170, 9, -189]} material={tankMat}>
        <boxGeometry args={[150, 18, 40]} />
      </mesh>
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
  const towerRef = useRef<MechazillaApi | null>(null);
  const glbTower = useGlbTower();
  // Callback ref so the pre-catch stance (chopsticks open) applies whichever
  // tower actually mounts — the GLB can arrive late (Suspense) or be swapped
  // for the procedural fallback by the boundary.
  const attachTower = useCallback((api: MechazillaApi | null) => {
    towerRef.current = api;
    api?.setOpening(1);
  }, []);
  const procedural = <MechazillaTower ref={attachTower} />;
  return (
    <group>
      {glbTower ? (
        <TowerGlbBoundary fallback={procedural}>
          <Suspense fallback={procedural}>
            <MechazillaTowerGLB ref={attachTower} />
          </Suspense>
        </TowerGlbBoundary>
      ) : (
        procedural
      )}
      <Olm />
      <TankFarm />
      <WestSupportArea />
      <Apron />
    </group>
  );
}
