/**
 * Community-sourced Mechazilla tower (SLS-76) — a CC-BY print kit assembled
 * into a GLB by `tools/assets/build-tower-glb.mjs` and shipped under
 * `public/assets/mechazilla-tower.glb`, replacing the procedural
 * `MechazillaTower.tsx`.
 *
 * The GLB is emitted in world space (Y-up metres, base at y=0, tower column on
 * the origin, fitted to TOWER_HEIGHT_M). The two chopstick arms are separate
 * named nodes ("LeftChopstick" / "RightChopstick") whose origin is each arm's
 * measured hinge tube, plus the "Carriage" frame — this component drives them
 * with the same `MechazillaApi` contract as the procedural tower (clamped
 * commands, first-order lag τ≈0.5 s, physics-sourced open swing), so it is a
 * drop-in.
 *
 * Default tower since the owner validated it in-sim (2026-07-16); `?tower=proc`
 * falls back to the procedural one.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import {
  ARM_ANGLE_OPEN_RAD,
  chopstickCatchPoints,
  DEFAULT_ARM_HEIGHT_M,
  DEFAULT_TOWER_STATE,
  TOWER_HEIGHT_M,
  type Vec3,
} from "@starship-catch-sim/physics";
import { Group } from "three";

import { type MechazillaApi } from "./MechazillaTower";
import { segmentChain } from "./armSegments";
import { towerTuneEnabled, useTowerTuneStore } from "../state/towerTuneStore";
import { ARM_SEGMENTS, reportArmSegmentBoxes } from "../sim/siteCollision";

const BASE = import.meta.env.BASE_URL;
export const TOWER_GLB_URL = `${BASE}assets/mechazilla-tower.glb`;
export const DRACO_DECODER_PATH = `${BASE}draco/`;

// Same articulation limits/lag as the procedural tower (MechazillaTower.tsx).
const ARM_HEIGHT_MIN = 30;
const ARM_HEIGHT_MAX = 130;
const TAU_OPENING = 0.5; // s
const TAU_HEIGHT = 0.5; // s

// Visual max open angle for the GLB chopstick meshes. The physics abstract
// arm swings ARM_ANGLE_OPEN_RAD (110°) at armOpeningT=1, but the real
// print-kit arms reach their full mechanical open at ~half that — beyond it
// they over-rotate (owner note, 2026-07-17). This governs the MESH pose only;
// getCatchPoints stays physics-sourced and the catch happens closed
// (opening→0), where visual and physics coincide exactly.
const VISUAL_OPEN_RAD = ARM_ANGLE_OPEN_RAD / 2;

const clampHeight = (y: number) =>
  Math.min(ARM_HEIGHT_MAX, Math.max(ARM_HEIGHT_MIN, y));

type Props = {
  /** Accepted for parity with the procedural tower; the GLB is world-anchored. */
  position?: Vec3;
};

export const MechazillaTowerGLB = forwardRef<MechazillaApi, Props>(
  function MechazillaTowerGLB(_props, ref) {
    const { scene } = useGLTF(TOWER_GLB_URL, DRACO_DECODER_PATH) as unknown as {
      scene: Group;
    };
    // Clone so multiple mounts don't fight over one graph, then lift the
    // articulated nodes out of the tower into their own group — so their yaw
    // can be tuned about the tower axis independently of the tower's own yaw
    // and the whole assembly can ride up/down as one carriage.
    const { column, arms, carriage, left, right } = useMemo(() => {
      const clone = scene.clone(true);
      const armGroup = new Group();
      const l = clone.getObjectByName("LeftChopstick") ?? null;
      const r = clone.getObjectByName("RightChopstick") ?? null;
      const carriage = clone.getObjectByName("Carriage") ?? null;
      if (l) armGroup.add(l); // reparents out of the tower column
      if (r) armGroup.add(r);
      if (carriage) armGroup.add(carriage); // rides with the chopsticks
      return { column: clone, arms: armGroup, carriage, left: l, right: r };
    }, [scene]);

    // MechazillaApi command state (same shape as the procedural tower):
    // commanded values are clamped, real values chase them with a first-order
    // lag in useFrame. Physics-canonical catch geometry is computed from the
    // physics module (NOT the mesh) at the *real* (lagged) pose.
    const cmd = useRef({
      openingCmd: DEFAULT_TOWER_STATE.armOpeningT,
      openingReal: DEFAULT_TOWER_STATE.armOpeningT,
      heightCmd: DEFAULT_TOWER_STATE.armHeightM,
      heightReal: DEFAULT_TOWER_STATE.armHeightM,
      target: null as Vec3 | null,
    });
    const debugGroup = useRef<Group>(null);
    // Last arm pose the segment collider was rebuilt at (SLS-84), so useFrame
    // only recomputes when the arms actually move. Seeded to impossible values
    // so the FIRST frame always reports (a NaN seed would make every
    // `|NaN − x| > eps` compare false → the boxes would never be reported).
    const lastArmPose = useRef({ opening: -999, height: -999 });

    // Clear the reported arm collider on unmount so a fallback to the procedural
    // tower (which doesn't report) can't collide against stale GLB boxes.
    useEffect(() => () => reportArmSegmentBoxes([]), []);

    // Dev tuning (`?tune=1`): the owner drives yaw + arm pose live. Tuned arm
    // opening/height feed the same command path (so they get the same lag).
    const tuning = useMemo(towerTuneEnabled, []);
    const yawDeg = useTowerTuneStore((s) => s.yawDeg);
    const towerDx = useTowerTuneStore((s) => s.towerDx);
    const towerDz = useTowerTuneStore((s) => s.towerDz);
    const armYawDeg = useTowerTuneStore((s) => s.armYawDeg);
    const tuneOpen = useTowerTuneStore((s) => s.armOpen);
    const tuneArmHeight = useTowerTuneStore((s) => s.armHeightM);
    const carriageDx = useTowerTuneStore((s) => s.carriageDx);
    const carriageDy = useTowerTuneStore((s) => s.carriageDy);
    const carriageDz = useTowerTuneStore((s) => s.carriageDz);
    const carriagePitchDeg = useTowerTuneStore((s) => s.carriagePitchDeg);
    const carriageYawDeg = useTowerTuneStore((s) => s.carriageYawDeg);
    const carriageRollDeg = useTowerTuneStore((s) => s.carriageRollDeg);

    useEffect(() => {
      if (!carriage) return;
      // carriage GLB node is seated at (0, armHeight, 0) inside the arm group
      // (which itself rides to the commanded height); pose from the store
      const rad = Math.PI / 180;
      carriage.position.set(carriageDx, DEFAULT_ARM_HEIGHT_M + carriageDy, carriageDz);
      carriage.rotation.set(carriagePitchDeg * rad, carriageYawDeg * rad, carriageRollDeg * rad);
    }, [carriage, carriageDx, carriageDy, carriageDz, carriagePitchDeg, carriageYawDeg, carriageRollDeg]);

    useEffect(() => {
      if (!tuning) return;
      cmd.current.openingCmd = Math.min(1, Math.max(0, tuneOpen));
      cmd.current.heightCmd = clampHeight(tuneArmHeight);
    }, [tuning, tuneOpen, tuneArmHeight]);

    // First-order lag + application to the meshes, mirroring the procedural
    // tower. Open swing is the physics ARM_ANGLE_OPEN_RAD (single-sourced) so
    // the rendered arms match the catch hard-points for every opening t.
    useFrame((_, dt) => {
      const s = cmd.current;
      const a = 1 - Math.exp(-dt / TAU_OPENING);
      s.openingReal += (s.openingCmd - s.openingReal) * a;
      const b = 1 - Math.exp(-dt / TAU_HEIGHT);
      s.heightReal += (s.heightCmd - s.heightReal) * b;

      const swing = VISUAL_OPEN_RAD * s.openingReal;
      if (left) left.rotation.y = swing;
      if (right) right.rotation.y = -swing;
      // the whole chopstick assembly (arms + carriage) rides the tower
      arms.position.y = s.heightReal - DEFAULT_ARM_HEIGHT_M;

      // Report each arm's world-space segment-chain collider (SLS-84) so the
      // sim's arm collision rides the drawn arms. Recompute only when the arm
      // pose actually changes (opening/height) — otherwise the boxes are static,
      // so per-frame vertex traversal would be wasted work against the 60 fps
      // budget. Boxes are TIGHT (no inflate): the booster capsule (ADR-020)
      // supplies the body radius at test time.
      if (left && right) {
        const p = lastArmPose.current;
        if (
          Math.abs(p.opening - s.openingReal) > 1e-4 ||
          Math.abs(p.height - s.heightReal) > 1e-3
        ) {
          p.opening = s.openingReal;
          p.height = s.heightReal;
          reportArmSegmentBoxes([
            ...segmentChain(left, ARM_SEGMENTS),
            ...segmentChain(right, ARM_SEGMENTS),
          ]);
        }
      }

      // debug markers track the physics catch points (world/physics frame)
      const dbg = debugGroup.current;
      if (dbg && dbg.visible) {
        const pts = chopstickCatchPoints({
          ...DEFAULT_TOWER_STATE,
          armOpeningT: s.openingReal,
          armHeightM: s.heightReal,
        });
        pts.forEach((p, i) => {
          const m = dbg.children[i];
          if (m) m.position.set(p.x, p.y, p.z);
        });
        const tm = dbg.children[pts.length];
        if (tm) {
          tm.visible = s.target !== null;
          if (s.target) tm.position.set(s.target.x, s.target.y, s.target.z);
        }
      }
    });

    useImperativeHandle(
      ref,
      (): MechazillaApi => ({
        setOpening(t) {
          cmd.current.openingCmd = Math.max(0, Math.min(1, t));
        },
        setArmHeight(y: number) {
          cmd.current.heightCmd = clampHeight(y);
        },
        closeOnTarget(target: Vec3) {
          cmd.current.target = target;
          cmd.current.heightCmd = clampHeight(target.y);
          cmd.current.openingCmd = 0;
        },
        getCatchPoints(): Vec3[] {
          return [
            ...chopstickCatchPoints({
              ...DEFAULT_TOWER_STATE,
              armOpeningT: cmd.current.openingReal,
              armHeightM: cmd.current.heightReal,
            }),
          ];
        },
        setDebugVisible(v: boolean) {
          if (debugGroup.current) debugGroup.current.visible = v;
        },
      }),
      [],
    );

    const yawRad = (yawDeg * Math.PI) / 180;
    const armYawRad = (armYawDeg * Math.PI) / 180;
    return (
      <>
        <group position={[towerDx, 0, towerDz]}>
          <group rotation={[0, yawRad, 0]}>
            <primitive object={column} />
          </group>
          {/* arms yaw with the tower plus an extra offset to square them to the face */}
          <group rotation={[0, yawRad + armYawRad, 0]}>
            <primitive object={arms} />
          </group>
        </group>
        {/* physics-frame debug markers: 4 catch hard-points + closeOnTarget
            target; hidden unless setDebugVisible(true). Deliberately OUTSIDE
            the tuned tower groups — they show where physics acts. */}
        <group ref={debugGroup} visible={false}>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={`pad-${i}`}>
              <sphereGeometry args={[0.6, 12, 12]} />
              <meshBasicMaterial color="#ff4444" />
            </mesh>
          ))}
          <mesh>
            <sphereGeometry args={[0.9, 12, 12]} />
            <meshBasicMaterial color="#44ff88" wireframe />
          </mesh>
        </group>
      </>
    );
  },
);

export const MECHAZILLA_TOWER_HEIGHT_M = TOWER_HEIGHT_M;

useGLTF.preload(TOWER_GLB_URL, DRACO_DECODER_PATH);
