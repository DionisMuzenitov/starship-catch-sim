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
