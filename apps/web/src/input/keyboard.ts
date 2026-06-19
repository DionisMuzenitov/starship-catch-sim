/**
 * Keyboard bindings for SLS-19 manual control. Translates DOM key events
 * into:
 *  - mutations on a `ManualInputState` (controller-level: throttle,
 *    gimbal, group selector, fins, ignite/SECO), and
 *  - method calls on the `SimRunner` (sim-level: pause, time scale,
 *    reset, rewind).
 *
 * Listeners attach to `window`. Each install call returns a cleanup
 * function that removes them — wire that to `useEffect` for tidy
 * tear-down.
 *
 * Keymap (matches the Jira plan comment):
 *   W / S          throttle up / down on selected group
 *   Shift+W        snap selected group to full throttle
 *   X              engine cutoff (all groups off, throttle zeroed)
 *   I              ignite (all groups on)
 *   Arrow keys     gimbal pitch / yaw
 *   Q / E          gimbal yaw (synonyms for ←/→)
 *   1 / 2 / 3      select engine group (centre / inner / outer)
 *   F              toggle fin/flap deployment
 *   Space          pause / resume
 *   [ / ]          time scale ÷2 / ×2
 *   R              reset to scenario initial conditions
 *   B              rewind 5 s
 *   C / T / G / O / N / M / V (SLS-17 camera modes — set on the camera store)
 *   H              cycle HUD mode (full / minimal / off) — SLS-18
 *   U              toggle units (metric / imperial) — SLS-18
 */

import type { ManualInputState } from "@starship-catch-sim/controllers";
import type { EngineGroup } from "@starship-catch-sim/physics";

import { useCameraStore, type CameraMode } from "../state/cameraStore.js";
import { useDebugStore } from "../state/debugStore.js";
import { useHudStore } from "../state/hudStore.js";
import { useReplayStore } from "../state/replayStore.js";

import type { SimRunner } from "../sim/runner.js";

type Bindings = {
  input: ManualInputState;
  runner: SimRunner;
};

function setGroup(input: ManualInputState, g: EngineGroup): void {
  input.selectedGroup = g;
}

function setCameraMode(mode: CameraMode): void {
  useCameraStore.getState().setMode(mode);
}

function shouldIgnoreEvent(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

// Sim-control keys (manual pilot input + runner control). Suppressed while
// the replay player owns the scene so the user can't accidentally pump
// throttle or reset the runner against an inert paused state.
const SIM_KEYS = new Set([
  "KeyW",
  "KeyS",
  "KeyX",
  "KeyI",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyQ",
  "KeyE",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "KeyF",
  "Space",
  "BracketLeft",
  "BracketRight",
  "KeyR",
  "KeyB",
]);

export function installKeyboardBindings(b: Bindings): () => void {
  const onKeyDown = (ev: KeyboardEvent) => {
    if (shouldIgnoreEvent(ev.target)) return;
    // Lock sim-control keys while replay is playing; camera + HUD keys
    // (C/T/G/O/N/M/V/H/U/P) stay live so the user can still pan around the
    // recording.
    if (
      useReplayStore.getState().mode === "replay" &&
      SIM_KEYS.has(ev.code)
    ) {
      return;
    }
    if (ev.repeat) {
      // Edge-triggered keys (toggle / pause / scale / reset / rewind)
      // already fired; held-down keys (throttle, gimbal) are polled
      // each tick via the booleans, so repeat events add nothing.
      return;
    }
    switch (ev.code) {
      case "KeyW":
        if (ev.shiftKey) b.input.fullThrottle = true;
        else b.input.throttleUp = true;
        return;
      case "KeyS":
        b.input.throttleDown = true;
        return;
      case "KeyX":
        b.input.engineCutoff = true;
        return;
      case "KeyI":
        b.input.ignite = true;
        return;
      case "ArrowUp":
        b.input.pitchUp = true;
        return;
      case "ArrowDown":
        b.input.pitchDown = true;
        return;
      case "ArrowLeft":
      case "KeyQ":
        b.input.yawLeft = true;
        return;
      case "ArrowRight":
      case "KeyE":
        b.input.yawRight = true;
        return;
      case "Digit1":
        setGroup(b.input, "centre");
        return;
      case "Digit2":
        setGroup(b.input, "inner");
        return;
      case "Digit3":
        setGroup(b.input, "outer");
        return;
      case "Digit4":
        setGroup(b.input, "ship");
        return;
      case "KeyP":
        useDebugStore.getState().toggleTrace();
        return;
      case "KeyF":
        b.input.finsDeployed = !b.input.finsDeployed;
        return;
      case "Space":
        ev.preventDefault();
        b.runner.togglePause();
        return;
      case "BracketLeft":
        b.runner.scaleDown();
        return;
      case "BracketRight":
        b.runner.scaleUp();
        return;
      case "KeyR":
        b.runner.reset();
        return;
      case "KeyB":
        b.runner.rewind(5);
        return;
      case "KeyC":
        setCameraMode("chase");
        return;
      case "KeyT":
        setCameraMode("tower");
        return;
      case "KeyG":
        setCameraMode("ground");
        return;
      case "KeyO":
        setCameraMode("free");
        return;
      case "KeyN":
        setCameraMode("onboard");
        return;
      case "KeyM":
        setCameraMode("cinematic");
        return;
      case "KeyV":
        useCameraStore.getState().cycleMode();
        return;
      case "KeyH":
        useHudStore.getState().cycleMode();
        return;
      case "KeyU":
        useHudStore.getState().toggleUnits();
        return;
    }
  };

  const onKeyUp = (ev: KeyboardEvent) => {
    if (shouldIgnoreEvent(ev.target)) return;
    switch (ev.code) {
      case "KeyW":
        b.input.throttleUp = false;
        b.input.fullThrottle = false;
        return;
      case "KeyS":
        b.input.throttleDown = false;
        return;
      case "KeyX":
        b.input.engineCutoff = false;
        return;
      case "KeyI":
        b.input.ignite = false;
        return;
      case "ArrowUp":
        b.input.pitchUp = false;
        return;
      case "ArrowDown":
        b.input.pitchDown = false;
        return;
      case "ArrowLeft":
      case "KeyQ":
        b.input.yawLeft = false;
        return;
      case "ArrowRight":
      case "KeyE":
        b.input.yawRight = false;
        return;
    }
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  };
}

/**
 * Right-mouse-drag → pointer deltas on the input state. Left-mouse stays
 * available for OrbitControls.
 */
export function installPointerBindings(
  input: ManualInputState,
  el: HTMLElement,
): () => void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onContext = (ev: MouseEvent) => ev.preventDefault();
  const onDown = (ev: MouseEvent) => {
    if (ev.button !== 2) return;
    dragging = true;
    lastX = ev.clientX;
    lastY = ev.clientY;
  };
  const onMove = (ev: MouseEvent) => {
    if (!dragging) return;
    const dx = ev.clientX - lastX;
    const dy = ev.clientY - lastY;
    lastX = ev.clientX;
    lastY = ev.clientY;
    input.pointerDx += dx;
    input.pointerDy += dy;
  };
  const onUp = (ev: MouseEvent) => {
    if (ev.button !== 2) return;
    dragging = false;
  };
  el.addEventListener("contextmenu", onContext);
  el.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  return () => {
    el.removeEventListener("contextmenu", onContext);
    el.removeEventListener("mousedown", onDown);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
}
