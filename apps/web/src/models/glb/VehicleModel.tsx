/**
 * Vehicle model with graceful fallback (SLS-44). Renders the sourced GLB
 * model (BoosterModelGLB / StarshipModelGLB); while it loads, and if it
 * ever fails to load/decode, the procedural model is shown instead — so
 * the sim always renders a correctly-posed vehicle. Same props as either
 * underlying model.
 */

import { Component, Suspense, type ReactNode } from "react";

import type {
  EngineState,
  Quat,
  SurfaceState,
  Vec3,
} from "@starship-catch-sim/physics";

import { BoosterModel, StarshipModel } from "../index";

import { BoosterModelGLB } from "./BoosterModelGLB";
import { StarshipModelGLB } from "./StarshipModelGLB";

/**
 * `position`/`attitude` are the model's PUBLIC POSE API — do not remove them.
 * They place the whole vehicle and are load-bearing for the static viewers that
 * have no simulation store: `LandingGhost` (owner-tuned ghost pose) and the
 * `/sandbox` labs (`SandboxModels`, `EnginePlumeLab`, `SandboxTower`,
 * `BoosterColliderLab`) all pass real, non-identity poses here.
 *
 * In the LIVE sim (`BoosterFlight`) these are passed as identity on purpose:
 * the shared body group owns the whole-body pose and drives it imperatively in
 * `useFrame` for smoothness (SLS-91). That also means the sim's articulation
 * (`engineStates`/`surfaceStates`, still prop-fed) rides the subscribed world
 * while the pose rides `getState()` — a ≤1-frame lag that is sub-perceptual and
 * intentionally NOT chased (SLS-90 closed won't-fix): the only lag-free fix
 * would couple these dumb, reusable models to the store and break the static
 * viewers above.
 */
type Props = {
  isShip: boolean;
  position: Vec3;
  attitude: Quat;
  engineStates: readonly EngineState[];
  surfaceStates: readonly SurfaceState[];
  altitudeFactor?: number;
};

class GlbErrorBoundary extends Component<
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

export function VehicleModel({ isShip, ...props }: Props) {
  const Glb = isShip ? StarshipModelGLB : BoosterModelGLB;
  const Proc = isShip ? StarshipModel : BoosterModel;
  const fallback = <Proc {...props} />;
  return (
    <GlbErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <Glb {...props} />
      </Suspense>
    </GlbErrorBoundary>
  );
}
