/**
 * Community-sourced Mechazilla tower (SLS-76) — a CC-BY print kit assembled
 * into a GLB by `tools/assets/build-tower-glb.mjs` and shipped under
 * `public/assets/mechazilla-tower.glb`, replacing the procedural
 * `MechazillaTower.tsx`.
 *
 * The GLB is emitted in world space (Y-up metres, base at y=0, tower column on
 * the origin, fitted to TOWER_HEIGHT_M). The two chopstick arms are separate
 * named nodes ("LeftChopstick" / "RightChopstick") whose origin is the hinge,
 * so this component rotates them for the open/close animation — the same
 * `MechazillaApi` contract the procedural tower exposes, so it is a drop-in.
 *
 * Default tower since the owner validated it in-sim (2026-07-16); `?tower=proc`
 * falls back to the procedural one.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";

import { useGLTF } from "@react-three/drei";
import {
  chopstickCatchPoints,
  DEFAULT_ARM_HEIGHT_M,
  DEFAULT_TOWER_STATE,
  TOWER_HEIGHT_M,
  type Vec3,
} from "@starship-catch-sim/physics";
import { Group } from "three";

import { type MechazillaApi } from "./MechazillaTower";
import { towerTuneEnabled, useTowerTuneStore } from "../state/towerTuneStore";

const BASE = import.meta.env.BASE_URL;
export const TOWER_GLB_URL = `${BASE}assets/mechazilla-tower.glb`;
export const DRACO_DECODER_PATH = `${BASE}draco/`;

/** Open swing per arm (radians about vertical): 0 = closed, this = fully open. */
const ARM_OPEN_RAD = 0.5;

type Props = {
  /** Accepted for parity with the procedural tower; the GLB is world-anchored. */
  position?: Vec3;
};

export const MechazillaTowerGLB = forwardRef<MechazillaApi, Props>(
  function MechazillaTowerGLB(_props, ref) {
    const { scene } = useGLTF(TOWER_GLB_URL, DRACO_DECODER_PATH) as unknown as {
      scene: Group;
    };
    // Clone so multiple mounts don't fight over one graph, then lift the two
    // chopstick nodes out of the tower into their own group — so their yaw can
    // be tuned about the tower axis independently of the tower's own yaw
    // (the arms sit ~offset from the model's front face; owner aligns them).
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

    // Physics-canonical catch geometry is tracked here and computed from the
    // physics module (NOT the mesh), so the catch logic is identical to the
    // procedural tower regardless of the visual model. TowerState is readonly,
    // so we hold the two mutable inputs and rebuild it on demand.
    const armOpeningT = useRef(DEFAULT_TOWER_STATE.armOpeningT);
    const armHeightM = useRef(DEFAULT_TOWER_STATE.armHeightM);

    // Dev tuning (`?tower=glb&tune=1`): the owner drives yaw + arm pose live.
    const tuning = useMemo(towerTuneEnabled, []);
    const yawDeg = useTowerTuneStore((s) => s.yawDeg);
    const towerDx = useTowerTuneStore((s) => s.towerDx);
    const towerDz = useTowerTuneStore((s) => s.towerDz);
    const armYawDeg = useTowerTuneStore((s) => s.armYawDeg);
    const tuneOpen = useTowerTuneStore((s) => s.armOpen);
    const carriageDx = useTowerTuneStore((s) => s.carriageDx);
    const carriageDy = useTowerTuneStore((s) => s.carriageDy);
    const carriageDz = useTowerTuneStore((s) => s.carriageDz);
    const carriagePitchDeg = useTowerTuneStore((s) => s.carriagePitchDeg);
    const carriageYawDeg = useTowerTuneStore((s) => s.carriageYawDeg);
    const carriageRollDeg = useTowerTuneStore((s) => s.carriageRollDeg);

    useEffect(() => {
      if (!carriage) return;
      // carriage GLB node is seated at (0, armHeight, 0); pose from the store
      const rad = Math.PI / 180;
      carriage.position.set(carriageDx, DEFAULT_ARM_HEIGHT_M + carriageDy, carriageDz);
      carriage.rotation.set(carriagePitchDeg * rad, carriageYawDeg * rad, carriageRollDeg * rad);
    }, [carriage, carriageDx, carriageDy, carriageDz, carriagePitchDeg, carriageYawDeg, carriageRollDeg]);

    useEffect(() => {
      if (!tuning) return;
      const a = ARM_OPEN_RAD * tuneOpen;
      if (left) left.rotation.y = a;
      if (right) right.rotation.y = -a;
    }, [tuning, tuneOpen, left, right]);

    useImperativeHandle(
      ref,
      (): MechazillaApi => ({
        setOpening(t) {
          const clamped = Math.max(0, Math.min(1, t));
          armOpeningT.current = clamped;
          const a = ARM_OPEN_RAD * clamped;
          if (left) left.rotation.y = a;
          if (right) right.rotation.y = -a;
        },
        setArmHeight(y: number) {
          armHeightM.current = y;
          // carriage articulation not yet modelled in the GLB (SLS-76 follow-up)
        },
        closeOnTarget(target: Vec3) {
          armHeightM.current = target.y;
          this.setOpening(0);
        },
        getCatchPoints(): Vec3[] {
          return [
            ...chopstickCatchPoints({
              ...DEFAULT_TOWER_STATE,
              armOpeningT: armOpeningT.current,
              armHeightM: armHeightM.current,
            }),
          ];
        },
        setDebugVisible(_v: boolean) {
          // no procedural debug gizmos on the GLB
        },
      }),
      [],
    );

    const yawRad = (yawDeg * Math.PI) / 180;
    const armYawRad = (armYawDeg * Math.PI) / 180;
    return (
      <group position={[towerDx, 0, towerDz]}>
        <group rotation={[0, yawRad, 0]}>
          <primitive object={column} />
        </group>
        {/* arms yaw with the tower plus an extra offset to square them to the face */}
        <group rotation={[0, yawRad + armYawRad, 0]}>
          <primitive object={arms} />
        </group>
      </group>
    );
  },
);

export const MECHAZILLA_TOWER_HEIGHT_M = TOWER_HEIGHT_M;

useGLTF.preload(TOWER_GLB_URL, DRACO_DECODER_PATH);
