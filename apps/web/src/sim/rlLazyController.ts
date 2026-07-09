/**
 * Browser-side lazy wrapper for the RL controller (SLS-30).
 *
 * `useSimRunner` constructs controllers synchronously, but the policy
 * artifact (~1.5 MB JSON) arrives by fetch. Until it lands, this wrapper
 * returns neutral control — engines off, which is exactly the trained
 * policy's null action (freefall is the aerodynamically stable mode), so
 * the handover is seamless. The fetch resolves in well under a second on
 * the static demo host; the descent lasts minutes.
 */

import {
  type Controller,
  RLController,
  type RLPolicyArtifact,
} from "@starship-catch-sim/controllers";
import {
  type ControlInput,
  neutralControl,
  type Vehicle,
  type Vec3,
  type World,
} from "@starship-catch-sim/physics";

export const RL_POLICY_URL = `${import.meta.env.BASE_URL}models/booster_policy.json`;

export class RLLazyController implements Controller {
  private inner: RLController | null = null;
  private loadError: Error | null = null;
  private readonly neutral: ControlInput;

  constructor(
    vehicle: Vehicle,
    targetPosition: Vec3,
    onReady?: (ok: boolean) => void,
  ) {
    const finCount = vehicle.surfaces.filter(
      (s) => s.kind === "grid_fin",
    ).length;
    const flapCount = vehicle.surfaces.filter((s) => s.kind === "flap").length;
    this.neutral = neutralControl(finCount, flapCount);
    void fetch(RL_POLICY_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`policy fetch ${r.status}`);
        return r.json() as Promise<RLPolicyArtifact>;
      })
      .then((artifact) => {
        this.inner = new RLController(vehicle, targetPosition, artifact);
        onReady?.(true);
      })
      .catch((err: unknown) => {
        this.loadError = err instanceof Error ? err : new Error(String(err));
        console.error("[rl] policy artifact failed to load:", this.loadError);
        onReady?.(false);
      });
  }

  isReady(): boolean {
    return this.inner !== null;
  }

  step(world: World): ControlInput {
    return this.inner ? this.inner.step(world) : this.neutral;
  }
}
