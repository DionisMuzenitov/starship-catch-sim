// @vitest-environment jsdom
import { createManualInputState } from "@starship-catch-sim/controllers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SimRunner } from "../sim/runner";
import { useHelpStore } from "../state/helpStore";
import { useReplayStore } from "../state/replayStore";

import { installKeyboardBindings } from "./keyboard";

function fakeRunner() {
  return {
    togglePause: vi.fn(),
    scaleUp: vi.fn(),
    scaleDown: vi.fn(),
    reset: vi.fn(),
    rewind: vi.fn(),
  };
}

let cleanup: (() => void) | undefined;

beforeEach(() => {
  useHelpStore.setState({ helpOpen: false, tutorialDismissed: true });
  useReplayStore.setState({ mode: "live" });
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function press(code: string, key = code) {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, key }));
}

describe("keyboard help gating (SLS-55)", () => {
  it("suppresses sim/runner hotkeys while the help overlay is open", () => {
    const input = createManualInputState();
    const runner = fakeRunner();
    cleanup = installKeyboardBindings({
      input,
      runner: runner as unknown as SimRunner,
    });

    useHelpStore.setState({ helpOpen: true });

    press("KeyR"); // reset
    press("Space"); // pause
    press("BracketLeft"); // time scale
    press("ArrowUp"); // gimbal

    expect(runner.reset).not.toHaveBeenCalled();
    expect(runner.togglePause).not.toHaveBeenCalled();
    expect(runner.scaleDown).not.toHaveBeenCalled();
    expect(input.pitchUp).toBe(false);
  });

  it("still runs hotkeys once the overlay is closed", () => {
    const input = createManualInputState();
    const runner = fakeRunner();
    cleanup = installKeyboardBindings({
      input,
      runner: runner as unknown as SimRunner,
    });

    // closed by default
    press("KeyR");
    press("ArrowUp");

    expect(runner.reset).toHaveBeenCalledTimes(1);
    expect(input.pitchUp).toBe(true);
  });

  it("? toggles the overlay and Esc closes it even while it is open", () => {
    const input = createManualInputState();
    const runner = fakeRunner();
    cleanup = installKeyboardBindings({
      input,
      runner: runner as unknown as SimRunner,
    });

    press("Slash", "?");
    expect(useHelpStore.getState().helpOpen).toBe(true);

    // Esc still reaches the handler while open (not swallowed by the gate).
    press("Escape");
    expect(useHelpStore.getState().helpOpen).toBe(false);
  });
});
