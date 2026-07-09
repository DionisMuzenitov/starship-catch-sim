/**
 * React glue for the `SimRunner`. Reads the active scenario id from
 * `useScenarioStore`, constructs a runner + ManualController, wires
 * keyboard + gamepad bindings, and drives the rAF loop with the
 * component's lifecycle.
 *
 * Scenario changes are handled by `<App />` re-mounting `<Scene />`
 * via `key={scenarioId}`, which tears down and rebuilds this hook.
 */

import { useEffect, useRef } from "react";

import {
  ManualController,
  MPCController,
  OverrideController,
  PIDController,
  createManualInputState,
  type Controller,
  type ManualInputState,
} from "@starship-catch-sim/controllers";
import { RLLazyController } from "./rlLazyController.js";
import {
  BoosterDescentStandard,
  createRecorder,
  scenarioById,
  type Scenario,
} from "@starship-catch-sim/physics";

import {
  installKeyboardBindings,
  installPointerBindings,
} from "../input/keyboard.js";
import { installGamepadPolling } from "../input/gamepad.js";
import { MPC_SERVICE_DISABLED, MPC_SERVICE_URL } from "./mpcService.js";
import { useControllerStore } from "../state/controllerStore.js";
import { useMpcStore } from "../state/mpcStore.js";
import { usePidStore } from "../state/pidStore.js";
import { useReplayStore } from "../state/replayStore.js";
import { useScenarioStore } from "../state/scenarioStore.js";
import { useSimStore } from "../state/simStore.js";

import { SimRunner } from "./runner.js";

export type UseSimRunner = {
  inputState: ManualInputState;
  runner: SimRunner;
};

function isManualInputActive(s: ManualInputState): boolean {
  if (
    s.throttleUp ||
    s.throttleDown ||
    s.fullThrottle ||
    s.engineCutoff ||
    s.ignite ||
    s.pitchUp ||
    s.pitchDown ||
    s.yawLeft ||
    s.yawRight
  ) {
    return true;
  }
  if (s.pointerDx !== 0 || s.pointerDy !== 0) return true;
  const gp = s.gamepad;
  if (gp) {
    if (
      Math.abs(gp.leftStickX) > 0.1 ||
      Math.abs(gp.leftStickY) > 0.1 ||
      gp.rightTrigger > 0.05 ||
      gp.leftTrigger > 0.05 ||
      gp.buttonA ||
      gp.buttonB
    ) {
      return true;
    }
  }
  return false;
}

export function useSimRunner(): UseSimRunner {
  const ref = useRef<UseSimRunner | null>(null);
  if (ref.current === null) {
    const scenarioId = useScenarioStore.getState().currentScenarioId;
    const scenario: Scenario =
      scenarioById(scenarioId) ?? BoosterDescentStandard;
    const inputState = createManualInputState();
    const controllerKind = useControllerStore.getState().kind;
    const manual = new ManualController(scenario.vehicle, inputState);
    const wrapWithOverride = (primary: Controller): Controller =>
      new OverrideController({
        primary,
        manual,
        isManualActive: () => isManualInputActive(inputState),
        overrideDurationS: 2,
        getMode: () => useControllerStore.getState().overrideMode,
        onTransition: (active) =>
          useControllerStore.getState().setOverrideActive(active),
      });
    let controller: Controller;
    if (controllerKind === "pid") {
      const pid = new PIDController(
        scenario.vehicle,
        scenario.targetCatch.targetPosition,
        () => usePidStore.getState().gains,
      );
      usePidStore.getState().clearFrames();
      pid.setObserver((frame) => usePidStore.getState().pushFrame(frame));
      controller = wrapWithOverride(pid);
    } else if (controllerKind === "mpc") {
      // On builds with no guidance service (the public static demo), inject
      // a transport that rejects WITHOUT touching the network — the browser
      // never logs a connection error, and the MPCController flies its PID
      // fallback (SLS-49). Otherwise POST to the resolved service URL.
      const mpc = new MPCController({
        vehicle: scenario.vehicle,
        targetPosition: scenario.targetCatch.targetPosition,
        gainsRef: () => usePidStore.getState().gains,
        ...(MPC_SERVICE_DISABLED
          ? { transport: () => Promise.reject(new Error("mpc-service-disabled")) }
          : { serviceUrl: MPC_SERVICE_URL ?? undefined }),
      });
      useMpcStore.getState().setServiceDisabled(MPC_SERVICE_DISABLED);
      useMpcStore.getState().setPlan(null);
      mpc.setPlanObserver((plan) => {
        useMpcStore.getState().setPlan(plan);
        useMpcStore.getState().setUsingFallback(mpc.isUsingFallback());
      });
      controller = wrapWithOverride(mpc);
    } else if (controllerKind === "rl") {
      // Neural policy (SLS-30): lazy-fetches the weights JSON; flies the
      // trained null action (freefall) for the sub-second load window.
      const rl = new RLLazyController(
        scenario.vehicle,
        scenario.targetCatch.targetPosition,
      );
      controller = wrapWithOverride(rl);
    } else {
      // Manual mode: ignore the override layer; clear the "YOU" flash.
      useControllerStore.getState().setOverrideActive(false);
      controller = manual;
    }
    const setWorld = useSimStore.getState().setWorld;
    const setPaused = useSimStore.getState().setPaused;
    const setScale = useSimStore.getState().setScale;
    const setOutcome = useSimStore.getState().setOutcome;
    const setLastReplay = useSimStore.getState().setLastReplay;
    // Booster vs ship is the only vehicle distinction so far; mark it from
    // the scenario id prefix so the replay header carries useful metadata.
    const vehicleId = scenarioId.startsWith("ship-") ? "ship" : "booster";
    const recorder = createRecorder({
      scenarioId,
      vehicleId,
      createdAt: new Date().toISOString(),
    });
    const runner = new SimRunner({
      vehicle: scenario.vehicle,
      initialWorld: scenario.initialWorld,
      controller,
      env: scenario.env,
      catchEnvelope: scenario.targetCatch,
      recorder,
      callbacks: {
        onRender: (world) => setWorld(world),
        onMeta: (meta) => {
          setPaused(meta.paused);
          setScale(meta.scale);
        },
        onOutcome: (outcome) => setOutcome(outcome),
        onReplay: (replay) => setLastReplay(replay),
      },
    });
    // Push the scenario's initial world into the store synchronously so
    // the first paint after a scenario switch already reflects the new
    // vehicle shape — otherwise the booster-shaped stale world would be
    // fed into the StarshipModel (or vice versa) and crash on render.
    setWorld(scenario.initialWorld);
    // Clear any outcome left over from a prior scenario.
    setOutcome(null);
    setLastReplay(null);
    ref.current = { inputState, runner };
  }

  useEffect(() => {
    const { inputState, runner } = ref.current!;
    runner.start();
    const removeKeys = installKeyboardBindings({ input: inputState, runner });
    const removePad = installGamepadPolling(inputState);
    const canvas = document.querySelector("canvas");
    const removePointer =
      canvas instanceof HTMLElement
        ? installPointerBindings(inputState, canvas)
        : () => undefined;

    // Force-pause the runner whenever replay mode is active so the live
    // simulation can't fight the replay driver's writes to simStore.world.
    // Exiting replay mode re-mounts the scene (via scenarioStore.epoch) so
    // we don't have to manually restore the paused state here.
    const unsubReplay = useReplayStore.subscribe((s) => {
      if (s.mode === "replay") runner.setPaused(true);
    });
    if (useReplayStore.getState().mode === "replay") runner.setPaused(true);

    return () => {
      runner.stop();
      removeKeys();
      removePad();
      removePointer();
      unsubReplay();
    };
  }, []);

  return ref.current;
}
