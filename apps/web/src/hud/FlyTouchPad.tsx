/**
 * On-screen movement pad for the FREE (fly) camera on touch devices (SLS-87).
 *
 * Free-cam translation is WASD/R-F keyboard-only; a touchscreen user (the sim
 * runs in-browser, including Android) can look by dragging but can't move. This
 * renders thumb buttons that drive the SAME shared `flyInput` flags the keyboard
 * sets, so `FreeLookRig` moves the camera unchanged.
 *
 * DOM overlay (not in the Canvas). Shown only in `free` mode on coarse-pointer
 * (touch) devices; force it on a desktop for testing with `?touchpad=1`.
 */

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

import { useCameraStore } from "../state/cameraStore";
import { flyInput, resetFlyInput, type FlyInput } from "../scene/camera/flyInput";

/** Human-readable direction for assistive tech (the visible glyph is decorative). */
const ARIA: Record<keyof FlyInput, string> = {
  forward: "Move forward",
  back: "Move back",
  left: "Strafe left",
  right: "Strafe right",
  up: "Rise",
  down: "Descend",
};

function PadButton({
  dir,
  label,
  className,
}: {
  dir: keyof FlyInput;
  label: string;
  className?: string;
}) {
  const press = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    // Capture so the release fires even if the thumb slides off the button.
    e.currentTarget.setPointerCapture(e.pointerId);
    flyInput[dir] = true;
  };
  const release = () => {
    flyInput[dir] = false;
  };
  return (
    <button
      type="button"
      aria-label={ARIA[dir]}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      className={`pointer-events-auto flex h-14 w-14 touch-none select-none items-center justify-center rounded-full bg-black/40 text-xl leading-none text-white/80 backdrop-blur-sm active:bg-white/30 ${className ?? ""}`}
    >
      {label}
    </button>
  );
}

export function FlyTouchPad() {
  const mode = useCameraStore((s) => s.mode);

  // Coarse-pointer (touch) devices only — or forced on desktop for testing.
  const visibleRef = useRef<boolean | null>(null);
  if (visibleRef.current === null) {
    // `?touchpad` forces it on for desktop testing; `?touchpad=0`/`false` opts out.
    const q = new URLSearchParams(window.location.search).get("touchpad");
    const forced = q !== null && q !== "0" && q !== "false";
    const coarse =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    visibleRef.current = forced || coarse;
  }

  // Release any held direction when the camera leaves free mode.
  useEffect(() => {
    if (mode !== "free") resetFlyInput();
  }, [mode]);

  if (mode !== "free" || !visibleRef.current) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex select-none items-end justify-between px-4">
      {/* Planar move pad (forward / back / strafe). */}
      <div className="grid grid-cols-3 grid-rows-3 gap-1">
        <span />
        <PadButton dir="forward" label="▲" />
        <span />
        <PadButton dir="left" label="◀" />
        <span />
        <PadButton dir="right" label="▶" />
        <span />
        <PadButton dir="back" label="▼" />
        <span />
      </div>
      {/* Vertical move (rise / descend). */}
      <div className="flex flex-col gap-1">
        <PadButton dir="up" label="⤒" />
        <PadButton dir="down" label="⤓" />
      </div>
    </div>
  );
}
