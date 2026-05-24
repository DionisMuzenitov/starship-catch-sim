/**
 * Physics step rate benchmark. Runs a fully-loaded Super Heavy through 60 s
 * of simulation time with all subsystems live (engines aggregate, aero
 * surfaces, drag, gravity, variable mass) and reports steps per second.
 *
 * SLS-13 target: ≥ 50,000 steps/sec on a modern laptop in node.
 *
 *   pnpm bench
 */

import {
  aggregate,
  bodyDragForce,
  constantWind,
  currentInertia,
  currentMass,
  consumeFuel,
  currentCoM,
  densityAt,
  full,
  initialEngineState,
  initialSurfaceState,
  pressureRatio,
  Quat,
  step,
  surfaceForceTorque,
  updateSurface,
  Vec3,
  BoosterFins,
  SuperHeavyEngines,
  SuperHeavyMass,
  type EngineCommand,
} from "../../packages/physics/src/index.js";
import type { RigidBodyState } from "../../packages/physics/src/index.js";

const G = 9.80665;

function runBenchmark() {
  const mp0 = full(SuperHeavyMass);
  const initialState: RigidBodyState = {
    position: Vec3.of(0, 1000, 0),
    velocity: Vec3.ZERO,
    attitude: Quat.IDENTITY,
    angularVelocity: Vec3.ZERO,
    mass: currentMass(mp0),
    inertia: currentInertia(mp0),
  };

  const engineCommand: EngineCommand = {
    gimbalPitchTarget: 0,
    gimbalYawTarget: 0,
    throttleTarget: 0.7,
    on: true,
  };
  const engineCommands = SuperHeavyEngines.map(() => engineCommand);
  const surfaceTargets = BoosterFins.map(() => 0);

  const refArea = Math.PI * 4.5 * 4.5;
  const cd = 0.8;
  const wind = constantWind(Vec3.ZERO);
  const dt = 0.01;
  const T = 60;
  const N = Math.round(T / dt);

  let state = initialState;
  let massProps = mp0;
  let engineStates = SuperHeavyEngines.map(() => ({
    ...initialEngineState(),
    throttle: 0.7,
    on: true,
  }));
  let surfaceStates = BoosterFins.map(() => initialSurfaceState());

  const start = performance.now();

  for (let i = 0; i < N; i++) {
    const t = i * dt;
    const com = currentCoM(massProps);
    const altitude = state.position.y;
    const density = densityAt(altitude);
    const pr = pressureRatio(altitude);

    const eng = aggregate(
      SuperHeavyEngines,
      engineStates,
      engineCommands,
      com,
      pr,
      dt,
    );
    engineStates = [...eng.newStates];

    let aeroForce = Vec3.ZERO;
    let aeroTorque = Vec3.ZERO;
    const nextSurfaces: typeof surfaceStates = [];
    for (let s = 0; s < BoosterFins.length; s++) {
      const sf = BoosterFins[s]!;
      const next = updateSurface(sf, surfaceStates[s]!, surfaceTargets[s]!, dt);
      nextSurfaces.push(next);
      const c = surfaceForceTorque(
        sf,
        next,
        state.velocity,
        state.angularVelocity,
        state.attitude,
        com,
        density,
      );
      aeroForce = Vec3.add(aeroForce, c.forceBody);
      aeroTorque = Vec3.add(aeroTorque, c.torqueBody);
    }
    surfaceStates = nextSurfaces;

    const v_rel = Vec3.sub(state.velocity, wind.at(state.position, t));
    const dragForceWorld = bodyDragForce(v_rel, altitude, refArea, cd);
    const gravityWorld = Vec3.of(0, -state.mass * G, 0);
    const bodyForceTotal = Vec3.add(eng.forceBody, aeroForce);
    const bodyForceWorld = Quat.rotateVec3(state.attitude, bodyForceTotal);
    const totalForceWorld = Vec3.add(
      Vec3.add(dragForceWorld, gravityWorld),
      bodyForceWorld,
    );
    const totalTorqueBody = Vec3.add(eng.torqueBody, aeroTorque);

    const nextState = step(state, totalForceWorld, totalTorqueBody, dt);

    massProps = consumeFuel(massProps, eng.mdotTotal * dt);
    state = {
      ...nextState,
      mass: currentMass(massProps),
      inertia: currentInertia(massProps),
    };
  }

  const elapsed = performance.now() - start;
  const stepsPerSec = (N / elapsed) * 1000;
  console.log(
    `physics-bench: ${N.toLocaleString()} steps in ${elapsed.toFixed(2)} ms ` +
      `→ ${stepsPerSec.toLocaleString(undefined, { maximumFractionDigits: 0 })} steps/sec`,
  );
  console.log(
    `final state: y=${state.position.y.toFixed(1)}m, ` +
      `vy=${state.velocity.y.toFixed(1)}m/s, ` +
      `mass=${state.mass.toFixed(0)}kg`,
  );
}

runBenchmark();
