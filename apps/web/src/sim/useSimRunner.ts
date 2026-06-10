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
  createManualInputState,
  type ManualInputState,
} from "@starship-catch-sim/controllers";
import {
  BoosterDescentStandard,
  scenarioById,
  type Scenario,
} from "@starship-catch-sim/physics";

import {
  installKeyboardBindings,
  installPointerBindings,
} from "../input/keyboard.js";
import { installGamepadPolling } from "../input/gamepad.js";
import { useScenarioStore } from "../state/scenarioStore.js";
import { useSimStore } from "../state/simStore.js";

import { SimRunner } from "./runner.js";

export type UseSimRunner = {
  inputState: ManualInputState;
  runner: SimRunner;
};

export function useSimRunner(): UseSimRunner {
  const ref = useRef<UseSimRunner | null>(null);
  if (ref.current === null) {
    const scenarioId = useScenarioStore.getState().currentScenarioId;
    const scenario: Scenario =
      scenarioById(scenarioId) ?? BoosterDescentStandard;
    const inputState = createManualInputState();
    const controller = new ManualController(scenario.vehicle, inputState);
    const setWorld = useSimStore.getState().setWorld;
    const setPaused = useSimStore.getState().setPaused;
    const setScale = useSimStore.getState().setScale;
    const runner = new SimRunner({
      vehicle: scenario.vehicle,
      initialWorld: scenario.initialWorld,
      controller,
      env: scenario.env,
      callbacks: {
        onRender: (world) => setWorld(world),
        onMeta: (meta) => {
          setPaused(meta.paused);
          setScale(meta.scale);
        },
      },
    });
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
    return () => {
      runner.stop();
      removeKeys();
      removePad();
      removePointer();
    };
  }, []);

  return ref.current;
}
