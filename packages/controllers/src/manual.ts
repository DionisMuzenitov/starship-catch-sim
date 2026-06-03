/**
 * `ManualController` — produces `ControlInput` from a raw input-state bag
 * that the runner's keyboard/gamepad bindings poke. The controller
 * doesn't touch the DOM; it just reads booleans and floats. That keeps
 * the v1 keymap headless-testable.
 *
 * Throttle/gimbal are rate-driven: while a control is held, the target
 * moves toward the limit at a fixed rate × dt. This gives an analogue
 * feel from binary keys.
 *
 * Keymap mapping (per SLS-19, with the open questions resolved on the
 * Jira plan comment):
 *   W / Shift+W / S / X           → throttle ±, full, cutoff (per group)
 *   Arrow keys or right-mouse-drag → gimbal pitch / yaw (centre engines)
 *   Q / E                          → gimbal yaw (single axis in v1; see note)
 *   1 / 2 / 3                      → engine group selector for W/S
 *   F                              → toggle fin/flap deflection
 *
 * Gamepad axes (Gamepad API):
 *   LS x/y → gimbal yaw / pitch
 *   RT/LT  → throttle up / down
 *   A      → ignite (turn engines on)
 *   B      → SECO (turn engines off)
 *
 * v1 known simplifications:
 *  - Q/E differential yaw uses the same single gimbalYaw axis as the
 *    arrow keys; true differential gimbaling across centre engines is
 *    a later refinement.
 *  - All fins share one deployment target; per-fin trim is later.
 *  - Starship `ship` engine group exists in the type but is not bound
 *    to a key (no Starship vehicle in v1).
 */

import {
  neutralControl,
  type ControlInput,
  type EngineGroup,
  type EngineGroupBag,
  type Vehicle,
  type World,
} from "@starship-catch-sim/physics";

import type { Controller } from "./types.js";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

/** Raw input bag. Bindings mutate fields directly; the controller reads. */
export type ManualInputState = {
  throttleUp: boolean;
  throttleDown: boolean;
  fullThrottle: boolean;
  engineCutoff: boolean;
  ignite: boolean;
  /** Gimbal pitch up/down — body +X axis, arrow up / down. */
  pitchUp: boolean;
  pitchDown: boolean;
  /** Gimbal yaw left/right — body +Z axis, arrow left / right or Q/E. */
  yawLeft: boolean;
  yawRight: boolean;
  /** Mouse pointer delta (right-button drag), zeroed every step after read. */
  pointerDx: number;
  pointerDy: number;
  /** Engine group W/S currently controls. */
  selectedGroup: EngineGroup;
  /** Fin deployment toggle target. False = stowed (0 rad). */
  finsDeployed: boolean;
  /** Optional gamepad inputs (-1..+1 sticks, 0..1 triggers). */
  gamepad: {
    leftStickX: number;
    leftStickY: number;
    rightTrigger: number;
    leftTrigger: number;
    buttonA: boolean;
    buttonB: boolean;
  } | null;
};

export function createManualInputState(): ManualInputState {
  return {
    throttleUp: false,
    throttleDown: false,
    fullThrottle: false,
    engineCutoff: false,
    ignite: false,
    pitchUp: false,
    pitchDown: false,
    yawLeft: false,
    yawRight: false,
    pointerDx: 0,
    pointerDy: 0,
    selectedGroup: "centre",
    finsDeployed: false,
    gamepad: null,
  };
}

const THROTTLE_RATE_PER_S = 0.5; // 100 % in 2 s
const GIMBAL_RATE_PER_S = 0.3; // rad/s, well above the engine slew-rate cap
const POINTER_GAIN = 0.002; // rad per pixel of pointer drag
const FIN_DEFLECTION = 0.25; // rad when deployed (~15°)

export class ManualController implements Controller {
  private readonly finCount: number;
  private readonly flapCount: number;
  private throttle: EngineGroupBag<number> = {
    centre: 0,
    inner: 0,
    outer: 0,
    ship: 0,
  };
  private enginesOn: EngineGroupBag<boolean> = {
    centre: false,
    inner: false,
    outer: false,
    ship: false,
  };
  private gimbalPitch = 0;
  private gimbalYaw = 0;

  constructor(
    vehicle: Vehicle,
    private readonly input: ManualInputState,
  ) {
    this.finCount = vehicle.surfaces.filter((s) => s.kind === "grid_fin").length;
    this.flapCount = vehicle.surfaces.filter((s) => s.kind === "flap").length;
  }

  step(_world: World, dt: number): ControlInput {
    this.applyThrottle(dt);
    this.applyIgnition();
    this.applyGimbal(dt);
    this.applyGamepad(dt);

    const finTarget = this.input.finsDeployed ? FIN_DEFLECTION : 0;
    const flapTarget = this.input.finsDeployed ? FIN_DEFLECTION : 0;

    const base = neutralControl(this.finCount, this.flapCount);
    return {
      ...base,
      engineGroups: { ...this.throttle },
      enginesOn: { ...this.enginesOn },
      gimbalPitch: this.gimbalPitch,
      gimbalYaw: this.gimbalYaw,
      fins: new Array(this.finCount).fill(finTarget),
      flaps: new Array(this.flapCount).fill(flapTarget),
    };
  }

  private applyThrottle(dt: number): void {
    const g = this.input.selectedGroup;
    const cur = this.throttle[g];
    let next = cur;

    if (this.input.engineCutoff) {
      this.throttle = { centre: 0, inner: 0, outer: 0, ship: 0 };
      this.enginesOn = {
        centre: false,
        inner: false,
        outer: false,
        ship: false,
      };
      return;
    }
    if (this.input.fullThrottle) {
      next = 1;
    } else if (this.input.throttleUp) {
      next = clamp01(cur + THROTTLE_RATE_PER_S * dt);
    } else if (this.input.throttleDown) {
      next = clamp01(cur - THROTTLE_RATE_PER_S * dt);
    }
    this.throttle = { ...this.throttle, [g]: next };
  }

  private applyIgnition(): void {
    if (this.input.ignite) {
      this.enginesOn = {
        centre: true,
        inner: true,
        outer: true,
        ship: true,
      };
    }
  }

  private applyGimbal(dt: number): void {
    let dPitch = 0;
    let dYaw = 0;
    if (this.input.pitchUp) dPitch += GIMBAL_RATE_PER_S * dt;
    if (this.input.pitchDown) dPitch -= GIMBAL_RATE_PER_S * dt;
    if (this.input.yawLeft) dYaw -= GIMBAL_RATE_PER_S * dt;
    if (this.input.yawRight) dYaw += GIMBAL_RATE_PER_S * dt;
    dPitch += this.input.pointerDy * POINTER_GAIN;
    dYaw += this.input.pointerDx * POINTER_GAIN;
    // Pointer deltas are accumulated; clear them once consumed.
    this.input.pointerDx = 0;
    this.input.pointerDy = 0;

    // Soft limit — the engine plant clamps to its own maxGimbal anyway,
    // but keeping the command bounded avoids unbounded growth when held.
    this.gimbalPitch = clamp(this.gimbalPitch + dPitch, -0.35, 0.35);
    this.gimbalYaw = clamp(this.gimbalYaw + dYaw, -0.35, 0.35);
  }

  private applyGamepad(dt: number): void {
    const gp = this.input.gamepad;
    if (!gp) return;
    if (gp.buttonA) this.applyIgniteOn();
    if (gp.buttonB) this.applySECO();
    if (gp.rightTrigger > 0) {
      const g = this.input.selectedGroup;
      this.throttle = {
        ...this.throttle,
        [g]: clamp01(this.throttle[g] + gp.rightTrigger * THROTTLE_RATE_PER_S * dt),
      };
    }
    if (gp.leftTrigger > 0) {
      const g = this.input.selectedGroup;
      this.throttle = {
        ...this.throttle,
        [g]: clamp01(this.throttle[g] - gp.leftTrigger * THROTTLE_RATE_PER_S * dt),
      };
    }
    this.gimbalYaw = clamp(
      this.gimbalYaw + gp.leftStickX * GIMBAL_RATE_PER_S * dt,
      -0.35,
      0.35,
    );
    this.gimbalPitch = clamp(
      this.gimbalPitch + gp.leftStickY * GIMBAL_RATE_PER_S * dt,
      -0.35,
      0.35,
    );
  }

  private applyIgniteOn(): void {
    this.enginesOn = {
      centre: true,
      inner: true,
      outer: true,
      ship: true,
    };
  }

  private applySECO(): void {
    this.enginesOn = {
      centre: false,
      inner: false,
      outer: false,
      ship: false,
    };
  }
}
