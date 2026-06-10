import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";

import { useFrame } from "@react-three/fiber";
import type { Vec3 } from "@starship-catch-sim/physics";
import { type Group, MeshStandardMaterial, Vector3 } from "three";

// Real-world dimensions, approximate gameplay constants.
export const MECHAZILLA_TOWER_HEIGHT_M = 146; // m
const TOWER_HEIGHT = MECHAZILLA_TOWER_HEIGHT_M;
const LEG_RADIUS = 0.5; // m (1 m diameter per ticket)
const LEG_FOOTPRINT = 12; // m (corner-to-corner of the square base)
const BRACE_SPACING = 10; // m (cross-bracing every 10 m)
const BRACE_THICKNESS = 0.4; // m
const ARM_HINGE_OFFSET = 5; // m to either side of tower centreline
const ARM_PIVOT_FROM_TOWER = 1.5; // m radial offset from leg face
const ARM_LENGTH = 30; // m
const ARM_BEAM_WIDTH = 1.2;
const ARM_BEAM_HEIGHT = 1.8;
const DEFAULT_ARM_HEIGHT = 91; // m (matches real Mechazilla chopstick height)
const ARM_HEIGHT_MIN = 30;
const ARM_HEIGHT_MAX = 130;

// Arm swing: angle measured from "pointing toward rocket axis" (0 = closed,
// embracing the booster) to "pointing outward" (open). The two arms mirror.
const ARM_ANGLE_CLOSED = 0; // pointing toward rocket axis (gripping pose)
const ARM_ANGLE_OPEN = (110 * Math.PI) / 180; // swept wide open

// First-order lag on opening so commanded steps are smoothed visually.
const TAU_OPENING = 0.5; // s
const TAU_HEIGHT = 0.5; // s

// QD ("quick disconnect") arm — decorative for v1, mounted on the rocket-
// facing side of the tower at a fixed height.
const QD_ARM_HEIGHT = 60;
const QD_ARM_LENGTH = 10;

// World-space hard-points where the chopstick gripper pads contact the
// rocket. Two pads per arm — fore (positive X along arm) and aft (negative).
// At zero opening these sit just inside the rocket body radius (4.5 m) so
// the gripper pads "land on" the booster ring.
const HARDPOINT_FORE_OFFSET = 4.5; // m along arm from hinge
const HARDPOINT_AFT_OFFSET = -2.5; // m along arm from hinge

// Steel-truss material, slightly darker / rougher than the booster's stainless.
let towerMat: MeshStandardMaterial | null = null;
function getTowerMaterial(): MeshStandardMaterial {
  if (!towerMat) {
    towerMat = new MeshStandardMaterial({
      color: "#6e7682",
      metalness: 0.5,
      roughness: 0.55,
    });
  }
  return towerMat;
}

let armMat: MeshStandardMaterial | null = null;
function getArmMaterial(): MeshStandardMaterial {
  if (!armMat) {
    armMat = new MeshStandardMaterial({
      color: "#8a929d",
      metalness: 0.55,
      roughness: 0.5,
    });
  }
  return armMat;
}

export type MechazillaApi = {
  /** 0 = closed (gripping), 1 = wide open. Smoothed with τ ≈ 0.5 s. */
  setOpening(t: number): void;
  /** Set the arm carriage Y position along the tower (metres). */
  setArmHeight(y: number): void;
  /**
   * Drive arm height to match `target.y` and close the arms (opening → 0).
   * Convenience for the catch sequence.
   */
  closeOnTarget(target: Vec3): void;
  /** World-space positions of the 4 catch hard-points (fore/aft × left/right). */
  getCatchPoints(): Vec3[];
  /** Toggle the debug helpers (hard-point markers, target indicator). */
  setDebugVisible(v: boolean): void;
};

type Props = {
  /** Tower base world position. Defaults to origin (the world convention). */
  position?: Vec3;
};

/**
 * Leg layout: 4 corners of a square plan, centred on the tower's origin.
 * The "rocket side" of the tower (where the chopsticks face) is +X.
 */
function legOffsets(): Array<[number, number]> {
  const h = LEG_FOOTPRINT / 2;
  return [
    [-h, -h],
    [-h, h],
    [h, -h],
    [h, h],
  ];
}

export const MechazillaTower = forwardRef<MechazillaApi, Props>(
  function MechazillaTower({ position = { x: 0, y: 0, z: 0 } }, ref) {
    const rootRef = useRef<Group>(null);
    const armCarriageRef = useRef<Group>(null);
    const armLeftRef = useRef<Group>(null);
    const armRightRef = useRef<Group>(null);
    const debugRef = useRef<Group>(null);
    const targetIndicatorRef = useRef<Group>(null);

    // Reusable scratch for catch-point math so we don't allocate per frame.
    const tmpVec = useMemo(() => new Vector3(), []);

    // Commanded vs realised state, both kept on a ref so the imperative API
    // can poke them without re-rendering.
    const state = useRef({
      openingCmd: 0,
      openingReal: 0,
      heightCmd: DEFAULT_ARM_HEIGHT,
      heightReal: DEFAULT_ARM_HEIGHT,
      target: null as Vec3 | null,
      debugVisible: false,
    });

    useImperativeHandle(
      ref,
      (): MechazillaApi => ({
        setOpening(t) {
          state.current.openingCmd = Math.min(1, Math.max(0, t));
        },
        setArmHeight(y) {
          state.current.heightCmd = Math.min(
            ARM_HEIGHT_MAX,
            Math.max(ARM_HEIGHT_MIN, y),
          );
        },
        closeOnTarget(target) {
          state.current.target = target;
          state.current.heightCmd = Math.min(
            ARM_HEIGHT_MAX,
            Math.max(ARM_HEIGHT_MIN, target.y),
          );
          state.current.openingCmd = 0;
        },
        getCatchPoints(): Vec3[] {
          // Resolve world positions of the four pads from the current arm
          // refs. If refs aren't mounted yet, fall back to a reasonable
          // default at the commanded height.
          const points: Vec3[] = [];
          for (const arm of [armLeftRef.current, armRightRef.current]) {
            if (!arm) continue;
            // Local arm frame: +X along the beam from hinge to tip.
            for (const offset of [HARDPOINT_FORE_OFFSET, HARDPOINT_AFT_OFFSET]) {
              tmpVec.set(offset, 0, 0);
              arm.localToWorld(tmpVec);
              points.push({ x: tmpVec.x, y: tmpVec.y, z: tmpVec.z });
            }
          }
          return points;
        },
        setDebugVisible(v) {
          state.current.debugVisible = v;
          if (debugRef.current) debugRef.current.visible = v;
        },
      }),
      [tmpVec],
    );

    useFrame((_, dt) => {
      const s = state.current;

      // First-order lag for both axes.
      const a = 1 - Math.exp(-dt / TAU_OPENING);
      s.openingReal += (s.openingCmd - s.openingReal) * a;
      const b = 1 - Math.exp(-dt / TAU_HEIGHT);
      s.heightReal += (s.heightCmd - s.heightReal) * b;

      // Apply to arm carriage and arm hinges.
      const swing =
        ARM_ANGLE_CLOSED + (ARM_ANGLE_OPEN - ARM_ANGLE_CLOSED) * s.openingReal;

      if (armCarriageRef.current) {
        armCarriageRef.current.position.y = s.heightReal;
      }
      // Left hinge swings +Y (counterclockwise from above), right mirrors.
      if (armLeftRef.current) armLeftRef.current.rotation.y = swing;
      if (armRightRef.current) armRightRef.current.rotation.y = -swing;

      // Target indicator follows the commanded target if any.
      if (targetIndicatorRef.current) {
        if (s.target) {
          targetIndicatorRef.current.visible = s.debugVisible;
          targetIndicatorRef.current.position.set(
            s.target.x - position.x,
            s.target.y - position.y,
            s.target.z - position.z,
          );
        } else {
          targetIndicatorRef.current.visible = false;
        }
      }
    });

    // ---- Geometry helpers ----

    const legs = useMemo(() => legOffsets(), []);

    // Cross-bracing: at each Y level, four perimeter X/Z beams + two
    // diagonals. Pre-compute the levels so we don't recreate JSX shape on
    // every frame.
    const braceLevels = useMemo(() => {
      const levels: number[] = [];
      for (let y = BRACE_SPACING; y < TOWER_HEIGHT; y += BRACE_SPACING) {
        levels.push(y);
      }
      return levels;
    }, []);

    return (
      <group
        ref={rootRef}
        position={[position.x, position.y, position.z]}
      >
        {/* Vertical legs */}
        {legs.map(([lx, lz], i) => (
          <mesh
            key={`leg-${i}`}
            position={[lx, TOWER_HEIGHT / 2, lz]}
            material={getTowerMaterial()}
          >
            <cylinderGeometry args={[LEG_RADIUS, LEG_RADIUS, TOWER_HEIGHT, 12]} />
          </mesh>
        ))}

        {/* Cross-bracing at each level */}
        {braceLevels.map((y) => (
          <group key={`brace-${y}`} position={[0, y, 0]}>
            {/* X-direction perimeter beams (front and back faces) */}
            <mesh
              position={[0, 0, -LEG_FOOTPRINT / 2]}
              material={getTowerMaterial()}
            >
              <boxGeometry args={[LEG_FOOTPRINT, BRACE_THICKNESS, BRACE_THICKNESS]} />
            </mesh>
            <mesh
              position={[0, 0, LEG_FOOTPRINT / 2]}
              material={getTowerMaterial()}
            >
              <boxGeometry args={[LEG_FOOTPRINT, BRACE_THICKNESS, BRACE_THICKNESS]} />
            </mesh>
            {/* Z-direction perimeter beams (left and right faces) */}
            <mesh
              position={[-LEG_FOOTPRINT / 2, 0, 0]}
              material={getTowerMaterial()}
            >
              <boxGeometry args={[BRACE_THICKNESS, BRACE_THICKNESS, LEG_FOOTPRINT]} />
            </mesh>
            <mesh
              position={[LEG_FOOTPRINT / 2, 0, 0]}
              material={getTowerMaterial()}
            >
              <boxGeometry args={[BRACE_THICKNESS, BRACE_THICKNESS, LEG_FOOTPRINT]} />
            </mesh>
            {/* Diagonals on the rocket-facing face (+X) */}
            <mesh
              position={[LEG_FOOTPRINT / 2, 0, 0]}
              rotation={[0, 0, Math.PI / 4]}
              material={getTowerMaterial()}
            >
              <boxGeometry
                args={[LEG_FOOTPRINT * Math.SQRT2, BRACE_THICKNESS * 0.7, BRACE_THICKNESS * 0.7]}
              />
            </mesh>
          </group>
        ))}

        {/* QD arm (decorative) — short box jutting toward +X */}
        <mesh
          position={[
            LEG_FOOTPRINT / 2 + QD_ARM_LENGTH / 2,
            QD_ARM_HEIGHT,
            0,
          ]}
          material={getArmMaterial()}
        >
          <boxGeometry args={[QD_ARM_LENGTH, 1.5, 2]} />
        </mesh>

        {/* Movable arm carriage: rides up/down the tower; chopsticks hinge
            off it on the rocket-facing side. */}
        <group ref={armCarriageRef} position={[0, DEFAULT_ARM_HEIGHT, 0]}>
          <Chopstick
            ref={armLeftRef}
            side="left"
          />
          <Chopstick
            ref={armRightRef}
            side="right"
          />
        </group>

        {/* Debug visuals — hard-point capsules + target indicator. Hidden
            unless setDebugVisible(true). */}
        <group ref={debugRef} visible={false}>
          {/* Hard-point markers are positioned relative to the arms. We
              draw them as children of the arms so they inherit the swing
              transform. */}
          {[armLeftRef, armRightRef].map((armRef, ai) => (
            <DebugMarkersAtArm
              key={`debug-arm-${ai}`}
              armRef={armRef}
            />
          ))}
          {/* Target indicator follows the closeOnTarget() argument. */}
          <group ref={targetIndicatorRef} visible={false}>
            <mesh>
              <sphereGeometry args={[2, 16, 12]} />
              <meshBasicMaterial
                color="#ff4466"
                transparent
                opacity={0.55}
                wireframe
              />
            </mesh>
          </group>
        </group>
      </group>
    );
  },
);

const Chopstick = forwardRef<Group, { side: "left" | "right" }>(
  function Chopstick({ side }, ref) {
    // Hinge sits on the rocket-facing face of the tower (+X), offset along
    // ±Z by ARM_HINGE_OFFSET.
    const hingeX = LEG_FOOTPRINT / 2 + ARM_PIVOT_FROM_TOWER;
    const hingeZ = (side === "left" ? -1 : 1) * ARM_HINGE_OFFSET;

    return (
      <group position={[hingeX, 0, hingeZ]} ref={ref}>
        {/* Main beam: extends along local +X from the hinge to the tip. */}
        <mesh
          position={[ARM_LENGTH / 2, 0, 0]}
          material={getArmMaterial()}
        >
          <boxGeometry args={[ARM_LENGTH, ARM_BEAM_HEIGHT, ARM_BEAM_WIDTH]} />
        </mesh>
        {/* Gripper pad at the fore catch point */}
        <mesh
          position={[HARDPOINT_FORE_OFFSET, 0, 0]}
          material={getArmMaterial()}
        >
          <boxGeometry args={[2.5, 1.4, 3.2]} />
        </mesh>
        {/* Aft gripper pad */}
        <mesh
          position={[HARDPOINT_AFT_OFFSET, 0, 0]}
          material={getArmMaterial()}
        >
          <boxGeometry args={[2.5, 1.4, 3.2]} />
        </mesh>
      </group>
    );
  },
);

/**
 * Debug markers parented to an arm: tiny wireframe spheres at the fore and
 * aft hard-points. Inherit the arm's swing so they always sit on the
 * gripper pads in world space.
 */
function DebugMarkersAtArm({
  armRef,
}: {
  armRef: React.RefObject<Group>;
}) {
  // Use a portal-style trick: we render two small wireframe spheres as
  // children of the parent group, but we drive them in useFrame to follow
  // the arm's world transform. Simpler: just spawn the markers as siblings
  // inside the arm group via a small effect. For v1, render them at the
  // arm's hard-point local positions every frame.
  const foreRef = useRef<Group>(null);
  const aftRef = useRef<Group>(null);
  const tmp = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const arm = armRef.current;
    if (!arm) return;
    if (foreRef.current) {
      tmp.set(HARDPOINT_FORE_OFFSET, 0, 0);
      arm.localToWorld(tmp);
      foreRef.current.parent?.worldToLocal(tmp);
      foreRef.current.position.copy(tmp);
    }
    if (aftRef.current) {
      tmp.set(HARDPOINT_AFT_OFFSET, 0, 0);
      arm.localToWorld(tmp);
      aftRef.current.parent?.worldToLocal(tmp);
      aftRef.current.position.copy(tmp);
    }
  });

  return (
    <>
      <group ref={foreRef}>
        <mesh>
          <sphereGeometry args={[0.7, 12, 8]} />
          <meshBasicMaterial color="#22ff88" wireframe />
        </mesh>
      </group>
      <group ref={aftRef}>
        <mesh>
          <sphereGeometry args={[0.7, 12, 8]} />
          <meshBasicMaterial color="#22ff88" wireframe />
        </mesh>
      </group>
    </>
  );
}
