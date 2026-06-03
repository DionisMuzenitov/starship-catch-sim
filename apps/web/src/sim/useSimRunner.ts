/**
 * React glue for the `SimRunner`. Constructs a runner with a
 * `ManualController`, wires it to the zustand `useSimStore`, installs
 * keyboard + gamepad bindings, and starts/stops the rAF loop with the
 * component's lifecycle.
 *
 * Returns the `inputState` (so a debug panel can show it later) and the
 * underlying `runner` (for tests + future programmatic control).
 */

import { useEffect, useRef } from "react";

import {
  ManualController,
  createManualInputState,
  type ManualInputState,
} from "@starship-catch-sim/controllers";
import {
  boosterDescentScenario,
  type Scenario,
} from "@starship-catch-sim/physics";

import {
  installKeyboardBindings,
  installPointerBindings,
} from "../input/keyboard.js";
import { installGamepadPolling } from "../input/gamepad.js";
import { useSimStore } from "../state/simStore.js";

import { SimRunner } from "./runner.js";

export type UseSimRunner = {
  inputState: ManualInputState;
  runner: SimRunner;
};

export function useSimRunner(): UseSimRunner {
  const ref = useRef<UseSimRunner | null>(null);
  if (ref.current === null) {
    const scenario: Scenario = boosterDescentScenario();
    const inputState = createManualInputState();
    const controller = new ManualController(scenario.vehicle, inputState);
    const setWorld = useSimStore.getState().setWorld;
    const setPaused = useSimStore.getState().setPaused;
    const setScale = useSimStore.getState().setScale;
    const runner = new SimRunner({
      vehicle: scenario.vehicle,
      initialWorld: scenario.initialWorld,
      controller,
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
