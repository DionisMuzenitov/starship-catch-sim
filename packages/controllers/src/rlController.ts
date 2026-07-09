/**
 * RLController — runs the imitation-learned neural policy (SLS-30).
 *
 * The policy is a tiny MLP (17 → 256 → 256 → 4, tanh) exported from the
 * SB3 checkpoint as plain JSON weights (`booster_policy.json`) and executed
 * with a hand-rolled synchronous forward pass. Deliberate deviation from the
 * original ONNX plan: a 2-layer MLP does not justify a ~20 MB WASM runtime
 * plus async inference inside the synchronous Controller.step contract.
 *
 * Two-rate structure, mirroring the training env (ADR-015):
 * - every `policyPeriodSteps` physics ticks (25 Hz): build the normalized
 *   17-dim observation, run the MLP, decode throttles + lean targets;
 * - EVERY physics tick (250 Hz): close the body-frame attitude PD from the
 *   held lean targets to gimbal commands.
 *
 * Action decode is the env's null-action semantics: throttle ≤ 0 means the
 * engine group is OFF; (0, 1] is a direct throttle command. Fins stay
 * neutral (the policy was trained with the inner loop owning attitude and
 * fins parked — SLS-54 revisits fin authority for stormy).
 */

import {
  type ControlInput,
  neutralControl,
  Quat,
  type Vehicle,
  Vec3,
  type World,
} from "@starship-catch-sim/physics";

import type { Controller } from "./types.js";

interface MLPLayer {
  readonly w: readonly (readonly number[])[]; // [out][in]
  readonly b: readonly number[];
  readonly activation?: "tanh";
}

/** Shape of apps/web/public/models/booster_policy.json (sls-mlp-policy-v1). */
export interface RLPolicyArtifact {
  readonly format: string;
  readonly obs: { readonly scale: readonly number[] };
  readonly action: { readonly policy_period_steps: number };
  readonly inner_loop_pd: {
    readonly k_att: number;
    readonly k_rate: number;
    readonly lean_max_rad: number;
    readonly max_gimbal_rad: number;
  };
  readonly mlp: { readonly layers: readonly MLPLayer[] };
}

/** Synchronous MLP forward pass — exported for the parity test. */
export function mlpForward(
  layers: readonly MLPLayer[],
  input: readonly number[],
): number[] {
  let x: number[] = [...input];
  for (const layer of layers) {
    const out = new Array<number>(layer.b.length);
    for (let i = 0; i < layer.b.length; i++) {
      let acc = layer.b[i];
      const row = layer.w[i];
      for (let j = 0; j < row.length; j++) acc += row[j] * x[j];
      out[i] = layer.activation === "tanh" ? Math.tanh(acc) : acc;
    }
    x = out;
  }
  return x;
}

/** Body-frame attitude PD: lean targets + body rates → gimbal (rad).
 * Exported for the parity test against the Python reference. */
export function innerLoopGimbal(
  attitude: Quat,
  angularVelocity: Vec3,
  leanX: number,
  leanZ: number,
  kAtt: number,
  kRate: number,
  maxGimbal: number,
): { pitch: number; yaw: number } {
  const up = Quat.rotateVec3(attitude, Vec3.of(0, 1, 0));
  const eWorld = Vec3.of(leanX - up.x, 0, leanZ - up.z);
  const eBody = Quat.rotateVec3(Quat.conjugate(attitude), eWorld);
  const clip = (v: number) => Math.max(-1, Math.min(1, v));
  return {
    pitch: clip(-kAtt * eBody.z + kRate * angularVelocity.x) * maxGimbal,
    yaw: clip(+kAtt * eBody.x + kRate * angularVelocity.z) * maxGimbal,
  };
}

export class RLController implements Controller {
  private readonly finCount: number;
  private readonly flapCount: number;
  private readonly target: Vec3;
  private readonly policy: RLPolicyArtifact;

  private tick = 0;
  private fullPropellantKg: number | null = null;
  // held between policy ticks (25 Hz command, 250 Hz PD)
  private thrCentre = 0;
  private thrInner = 0;
  private leanX = 0;
  private leanZ = 0;

  constructor(vehicle: Vehicle, targetPosition: Vec3, policy: RLPolicyArtifact) {
    if (policy.format !== "sls-mlp-policy-v1") {
      throw new Error(`unsupported policy artifact format: ${policy.format}`);
    }
    this.finCount = vehicle.surfaces.filter((s) => s.kind === "grid_fin").length;
    this.flapCount = vehicle.surfaces.filter((s) => s.kind === "flap").length;
    this.target = targetPosition;
    this.policy = policy;
  }

  /** Build the 17-dim normalized observation (layout per the artifact). */
  buildObservation(world: World): number[] {
    const rb = world.rigidBody;
    // fuel fraction is relative to the propellant load at controller start
    this.fullPropellantKg ??= world.mass.propellantMass;
    const fuel =
      this.fullPropellantKg > 0
        ? world.mass.propellantMass / this.fullPropellantKg
        : 0;
    const raw = [
      rb.position.x, rb.position.y, rb.position.z,
      rb.velocity.x, rb.velocity.y, rb.velocity.z,
      rb.attitude.x, rb.attitude.y, rb.attitude.z, rb.attitude.w,
      rb.angularVelocity.x, rb.angularVelocity.y, rb.angularVelocity.z,
      fuel,
      rb.position.x - this.target.x,
      rb.position.y - this.target.y,
      rb.position.z - this.target.z,
    ];
    const scale = this.policy.obs.scale;
    return raw.map((v, i) => v / scale[i]);
  }

  // dt unused: the two-rate cadence is tick-counted, not time-based.
  step(world: World): ControlInput {
    const period = this.policy.action.policy_period_steps;
    if (this.tick % period === 0) {
      const a = mlpForward(this.policy.mlp.layers, this.buildObservation(world))
        .map((v) => Math.max(-1, Math.min(1, v)));
      this.thrCentre = Math.max(0, a[0]);
      this.thrInner = Math.max(0, a[1]);
      this.leanX = a[2] * this.policy.inner_loop_pd.lean_max_rad;
      this.leanZ = a[3] * this.policy.inner_loop_pd.lean_max_rad;
    }
    this.tick++;

    const pd = this.policy.inner_loop_pd;
    const gimbal = innerLoopGimbal(
      world.rigidBody.attitude,
      world.rigidBody.angularVelocity,
      this.leanX,
      this.leanZ,
      pd.k_att,
      pd.k_rate,
      pd.max_gimbal_rad,
    );

    const base = neutralControl(this.finCount, this.flapCount);
    return {
      ...base,
      engineGroups: {
        centre: this.thrCentre,
        inner: this.thrInner,
        outer: 0,
        ship: 0,
      },
      enginesOn: {
        centre: this.thrCentre > 0.02,
        inner: this.thrInner > 0.02,
        outer: false,
        ship: false,
      },
      gimbalPitch: gimbal.pitch,
      gimbalYaw: gimbal.yaw,
    };
  }
}
