/**
 * Lightweight Gamepad API poller. Reads the first connected gamepad each
 * rAF and writes its axes/buttons into the `ManualInputState.gamepad`
 * field. The controller mixes gamepad input with keyboard input.
 *
 * Standard mapping (Xbox layout):
 *   axes[0/1] — left stick X / Y
 *   axes[2/3] — right stick X / Y (unused in v1)
 *   buttons[0] — A (ignite)
 *   buttons[1] — B (SECO)
 *   buttons[6] — LT
 *   buttons[7] — RT
 *
 * Triggers report `value` ∈ [0, 1]; sticks ∈ [-1, +1]. A small dead-zone
 * on sticks avoids drift from cheap pads.
 */

import type { ManualInputState } from "@starship-catch-sim/controllers";

const DEAD_ZONE = 0.08;

const deadzone = (v: number) => (Math.abs(v) < DEAD_ZONE ? 0 : v);

export function installGamepadPolling(
  input: ManualInputState,
): () => void {
  let rafId: number | null = null;
  const tick = () => {
    const pads = navigator.getGamepads?.();
    const pad = pads?.find((p) => p !== null) ?? null;
    if (pad) {
      input.gamepad = {
        leftStickX: deadzone(pad.axes[0] ?? 0),
        leftStickY: deadzone(pad.axes[1] ?? 0),
        leftTrigger: pad.buttons[6]?.value ?? 0,
        rightTrigger: pad.buttons[7]?.value ?? 0,
        buttonA: pad.buttons[0]?.pressed ?? false,
        buttonB: pad.buttons[1]?.pressed ?? false,
      };
    } else {
      input.gamepad = null;
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  return () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
  };
}
