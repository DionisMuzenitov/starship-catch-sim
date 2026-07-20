/**
 * Free-cam fly movement input (SLS-58). Set by `input/keyboard.ts` while the
 * camera is in `free` mode (WASD move, R/F up/down); read by `FreeLookRig` each
 * frame. A plain mutable object (matches the `ManualInputState` pattern) so it
 * causes no React re-renders.
 */

export type FlyInput = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
};

export const flyInput: FlyInput = {
  forward: false,
  back: false,
  left: false,
  right: false,
  up: false,
  down: false,
};

export function resetFlyInput(): void {
  flyInput.forward = false;
  flyInput.back = false;
  flyInput.left = false;
  flyInput.right = false;
  flyInput.up = false;
  flyInput.down = false;
}

/** Map a `KeyboardEvent.code` to a fly direction, or `null` if not a move key. */
export function flyDirForCode(code: string): keyof FlyInput | null {
  switch (code) {
    case "KeyW":
      return "forward";
    case "KeyS":
      return "back";
    case "KeyA":
      return "left";
    case "KeyD":
      return "right";
    case "KeyR":
      return "up";
    case "KeyF":
      return "down";
    default:
      return null;
  }
}
