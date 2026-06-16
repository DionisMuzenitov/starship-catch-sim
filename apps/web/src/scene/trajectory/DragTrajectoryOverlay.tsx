/**
 * Predicted drag-only trajectory overlay (SLS-21).
 *
 * Forward-rolls the current `World` with engines off using the canonical
 * `simStep` orchestrator + the scene's `SimEnv`, then draws the resulting
 * series of CoM positions as a translucent polyline via drei's `<Line>`.
 *
 * Toggled with the `P` key. Cached at ~2 Hz so the prediction doesn't
 * thrash the per-frame budget — 60 steps × 0.5 s = ~30 s of projection,
 * which is enough to see the ballistic arc of a belly-flopping ship.
 */

import { useEffect, useRef, useState } from "react";

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import {
  neutralControl,
  scenarioById,
  BoosterDescentStandard,
  simStep,
  type Scenario,
  type World,
} from "@starship-catch-sim/physics";

import { useDebugStore } from "../../state/debugStore.js";
import { useScenarioStore } from "../../state/scenarioStore.js";
import { useSimStore } from "../../state/simStore.js";

const TRACE_DT_S = 0.5;
const TRACE_STEPS = 60;
const RECOMPUTE_INTERVAL_S = 0.5;

function computeTrace(world: World, scenario: Scenario): [number, number, number][] {
  const ctl = neutralControl(
    scenario.vehicle.surfaces.filter((s) => s.kind === "grid_fin").length,
    scenario.vehicle.surfaces.filter((s) => s.kind === "flap").length,
  );
  const points: [number, number, number][] = [];
  let w = world;
  points.push([w.rigidBody.position.x, w.rigidBody.position.y, w.rigidBody.position.z]);
  for (let i = 0; i < TRACE_STEPS; i++) {
    w = simStep(w, scenario.vehicle, ctl, TRACE_DT_S, scenario.env);
    const r = w.rigidBody.position;
    points.push([r.x, r.y, r.z]);
    if (r.y <= 0) break;
  }
  return points;
}

export function DragTrajectoryOverlay() {
  const visible = useDebugStore((s) => s.traceVisible);
  const scenarioId = useScenarioStore((s) => s.currentScenarioId);
  const scenario = scenarioById(scenarioId) ?? BoosterDescentStandard;

  const [points, setPoints] = useState<[number, number, number][]>(() =>
    computeTrace(useSimStore.getState().world, scenario),
  );
  const lastRecomputeRef = useRef(0);

  // When toggled on, force an immediate recompute against the current world.
  useEffect(() => {
    if (visible) {
      setPoints(computeTrace(useSimStore.getState().world, scenario));
      lastRecomputeRef.current = 0;
    }
  }, [visible, scenario]);

  useFrame((_state, delta) => {
    if (!visible) return;
    lastRecomputeRef.current += delta;
    if (lastRecomputeRef.current >= RECOMPUTE_INTERVAL_S) {
      lastRecomputeRef.current = 0;
      setPoints(computeTrace(useSimStore.getState().world, scenario));
    }
  });

  if (!visible || points.length < 2) return null;
  return (
    <Line
      points={points}
      color="#7fb3ff"
      lineWidth={2}
      transparent
      opacity={0.7}
    />
  );
}
