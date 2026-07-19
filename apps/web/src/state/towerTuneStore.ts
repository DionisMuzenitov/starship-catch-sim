/**
 * Live tuning state for the community GLB tower (SLS-76). A dev-only panel
 * (`TowerTunePanel`, shown with `?tower=glb&tune=1`) drives these values and
 * `MechazillaTowerGLB` reads them, so the owner can dial the tower's facing and
 * arm pose in the running sim instead of round-tripping through re-bakes. The
 * values the owner settles on get baked back into the layout / component
 * defaults.
 */
import { create } from "zustand";

import {
  chopstickCaptureVolume,
  DEFAULT_ARM_HEIGHT_M,
  DEFAULT_TOWER_STATE,
} from "@starship-catch-sim/physics";

export type TowerTuneState = {
  /** Yaw of the whole tower about the vertical axis (degrees). */
  yawDeg: number;
  /** Planar offset of the whole tower (column + arms) from the world origin. */
  towerDx: number;
  towerDz: number;
  /** Extra yaw of just the chopstick assembly about the tower (degrees) —
   *  aligns the arms to the tower face independent of the tower yaw. */
  armYawDeg: number;
  /** Chopstick opening 0 = closed (gripping) … 1 = wide. */
  armOpen: number;
  /** Carriage / arm height along the tower (metres). */
  armHeightM: number;
  /** Carriage frame offset from the tower centre (metres) to seat it on the tower. */
  carriageDx: number;
  carriageDy: number;
  carriageDz: number;
  /** Carriage orientation (degrees): pitch = about X, yaw = about Y (tower
   *  axis), roll = about Z. Full 3-angle control for owner tuning. */
  carriagePitchDeg: number;
  carriageYawDeg: number;
  carriageRollDeg: number;
  /** OLM (rocket platform) yaw + planar offset from its measured position. */
  olmYawDeg: number;
  olmDx: number;
  olmDz: number;
  /** Ghost booster (landing-target alignment, SLS-76): world position of a
   *  static booster the owner nests into the visual chopsticks. Baked as the
   *  visual catch point → SITE_OFFSET shifts the scenery onto the physics one. */
  ghostX: number;
  ghostY: number;
  ghostZ: number;
  /** Tower collision box (SLS-86): nudge + half-extent scale on the drawn tower
   *  AABB so the owner can fit it to the visible lattice. */
  towerColOffX: number;
  towerColOffZ: number;
  towerColHalfX: number;
  towerColHalfZ: number;
  setYaw: (v: number) => void;
  setTowerDx: (v: number) => void;
  setTowerDz: (v: number) => void;
  setArmYaw: (v: number) => void;
  setArmOpen: (v: number) => void;
  setArmHeight: (v: number) => void;
  setCarriageDx: (v: number) => void;
  setCarriageDy: (v: number) => void;
  setCarriageDz: (v: number) => void;
  setCarriagePitch: (v: number) => void;
  setCarriageYaw: (v: number) => void;
  setCarriageRoll: (v: number) => void;
  setOlmYaw: (v: number) => void;
  setOlmDx: (v: number) => void;
  setOlmDz: (v: number) => void;
  setGhostX: (v: number) => void;
  setGhostY: (v: number) => void;
  setGhostZ: (v: number) => void;
  setTowerColOffX: (v: number) => void;
  setTowerColOffZ: (v: number) => void;
  setTowerColHalfX: (v: number) => void;
  setTowerColHalfZ: (v: number) => void;
};

/** Tower collision box defaults (SLS-86). Half-extents match SLS-79's
 *  yaw-inflated footprint (TOWER_FOOTPRINT/2 × 1.5 = 9 m); offsets nudge it. */
export const DEFAULT_TOWERCOL_OFF_X = 0;
export const DEFAULT_TOWERCOL_OFF_Z = 0;
export const DEFAULT_TOWERCOL_HALF_X = 9;
export const DEFAULT_TOWERCOL_HALF_Z = 9;

/** Physics catch point (capture-volume centre, ≈(8.5, 91, 0)) — the fixed
 *  frame the visual site must align to; also the ghost's starting position. */
export const PHYSICS_CATCH_POINT = chopstickCaptureVolume(DEFAULT_TOWER_STATE).center;

/**
 * Owner-baked ideal-catch pose (2026-07-17): the world position where the
 * ghost booster visually nests in the chopsticks, dialled in with `?tune=1`.
 * The real booster renders at PHYSICS_CATCH_POINT, so shifting the whole site
 * by (catch − ghost) drops the physics catch exactly into this visual cradle
 * — the +63 m up component is the "caught too high" correction the owner
 * noted (the booster was floating with its base at the arms; now its body
 * runs alongside the tower with the arms gripping near its top).
 */
const BAKED_GHOST_AT_CATCH = { x: 32.7, y: 27.7, z: -1.3 };

/**
 * World shift applied to ALL site visuals (tower, OLM, scenery, terrain) as
 * one, so the owner-nested visual catch cradle coincides with
 * PHYSICS_CATCH_POINT while preserving the owner's tower↔terrain shadow
 * alignment. Physics is never touched (numpy↔TS parity safe).
 */
export const SITE_OFFSET: readonly [number, number, number] = [
  PHYSICS_CATCH_POINT.x - BAKED_GHOST_AT_CATCH.x,
  PHYSICS_CATCH_POINT.y - BAKED_GHOST_AT_CATCH.y,
  PHYSICS_CATCH_POINT.z - BAKED_GHOST_AT_CATCH.z,
];

/**
 * Owner-aligned tower placement (SLS-76), dialled in against the satellite
 * shadows in the tuning panel. Tower yaw 47° squares the lattice to the real
 * footprint; arm yaw −44° puts the chopsticks' closed direction ~3° off east
 * (≈ the physics +X catch axis); the OLM offsets seat the platform in front.
 */
export const DEFAULT_TOWER_YAW_DEG = 47;
export const DEFAULT_TOWER_DX = 11;
export const DEFAULT_TOWER_DZ = 0;
export const DEFAULT_ARM_YAW_DEG = -44;
export const DEFAULT_OLM_YAW_DEG = -13;
export const DEFAULT_OLM_DX = 15;
export const DEFAULT_OLM_DZ = 20;
/** Carriage pose, owner-aligned in the tuning panel (2026-07-16). */
export const DEFAULT_CARRIAGE_DX = 4.0;
export const DEFAULT_CARRIAGE_DY = 0;
export const DEFAULT_CARRIAGE_DZ = 0;
export const DEFAULT_CARRIAGE_PITCH_DEG = 0;
export const DEFAULT_CARRIAGE_YAW_DEG = 180;
export const DEFAULT_CARRIAGE_ROLL_DEG = 90;

export const useTowerTuneStore = create<TowerTuneState>((set) => ({
  yawDeg: DEFAULT_TOWER_YAW_DEG,
  towerDx: DEFAULT_TOWER_DX,
  towerDz: DEFAULT_TOWER_DZ,
  armYawDeg: DEFAULT_ARM_YAW_DEG,
  armOpen: 1,
  armHeightM: DEFAULT_ARM_HEIGHT_M,
  carriageDx: DEFAULT_CARRIAGE_DX,
  carriageDy: DEFAULT_CARRIAGE_DY,
  carriageDz: DEFAULT_CARRIAGE_DZ,
  carriagePitchDeg: DEFAULT_CARRIAGE_PITCH_DEG,
  carriageYawDeg: DEFAULT_CARRIAGE_YAW_DEG,
  carriageRollDeg: DEFAULT_CARRIAGE_ROLL_DEG,
  olmYawDeg: DEFAULT_OLM_YAW_DEG,
  olmDx: DEFAULT_OLM_DX,
  olmDz: DEFAULT_OLM_DZ,
  ghostX: PHYSICS_CATCH_POINT.x,
  ghostY: PHYSICS_CATCH_POINT.y,
  ghostZ: PHYSICS_CATCH_POINT.z,
  setYaw: (yawDeg) => set({ yawDeg }),
  setTowerDx: (towerDx) => set({ towerDx }),
  setTowerDz: (towerDz) => set({ towerDz }),
  setArmYaw: (armYawDeg) => set({ armYawDeg }),
  setArmOpen: (armOpen) => set({ armOpen }),
  setArmHeight: (armHeightM) => set({ armHeightM }),
  setCarriageDx: (carriageDx) => set({ carriageDx }),
  setCarriageDy: (carriageDy) => set({ carriageDy }),
  setCarriageDz: (carriageDz) => set({ carriageDz }),
  setCarriagePitch: (carriagePitchDeg) => set({ carriagePitchDeg }),
  setCarriageYaw: (carriageYawDeg) => set({ carriageYawDeg }),
  setCarriageRoll: (carriageRollDeg) => set({ carriageRollDeg }),
  setOlmYaw: (olmYawDeg) => set({ olmYawDeg }),
  setOlmDx: (olmDx) => set({ olmDx }),
  setOlmDz: (olmDz) => set({ olmDz }),
  towerColOffX: DEFAULT_TOWERCOL_OFF_X,
  towerColOffZ: DEFAULT_TOWERCOL_OFF_Z,
  towerColHalfX: DEFAULT_TOWERCOL_HALF_X,
  towerColHalfZ: DEFAULT_TOWERCOL_HALF_Z,
  setGhostX: (ghostX) => set({ ghostX }),
  setGhostY: (ghostY) => set({ ghostY }),
  setGhostZ: (ghostZ) => set({ ghostZ }),
  setTowerColOffX: (towerColOffX) => set({ towerColOffX }),
  setTowerColOffZ: (towerColOffZ) => set({ towerColOffZ }),
  setTowerColHalfX: (towerColHalfX) => set({ towerColHalfX }),
  setTowerColHalfZ: (towerColHalfZ) => set({ towerColHalfZ }),
}));

/** `?tune=1` shows the tuning panel (GLB tower only — no effect with `?tower=proc`). */
export function towerTuneEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const p = new URLSearchParams(window.location.search);
  return p.get("tower") !== "proc" && p.get("tune") === "1";
}
