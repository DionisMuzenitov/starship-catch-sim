/**
 * Holds the gain bag for the cascaded PID, plus a ring buffer of the last
 * N debug frames the `PIDController` emits via its observer. The tuning
 * panel reads gains here and writes through the patch helpers; the live
 * charts subscribe to `frames` and re-render at the runner's rAF cadence.
 *
 * Default sample window: ~6 s at 250 Hz (1500 frames). Big enough for the
 * panel to plot the recent loop history without holding more memory than
 * the runner's own state.
 */

import {
  DEFAULT_PID_GAINS,
  type PIDControllerGains,
  type PIDDebugFrame,
} from "@starship-catch-sim/controllers";
import { create } from "zustand";

const FRAME_BUFFER_CAP = 1500;

type PidLoopKey =
  | "altitude"
  | "horizontalX"
  | "horizontalZ"
  | "attitudePitch"
  | "attitudeYaw";

type PidScalarKey =
  | "descentProfileK"
  | "finalApproachAltitudeM"
  | "finalApproachVyMps"
  | "ignitionAltitudeM"
  | "maxTiltRad";

export type PidGainPatch =
  | { kind: "loop"; loop: PidLoopKey; field: keyof PIDControllerGains["altitude"]; value: number }
  | { kind: "scalar"; field: PidScalarKey; value: number };

export type PidStoreState = {
  gains: PIDControllerGains;
  frames: PIDDebugFrame[];
  setGains: (next: PIDControllerGains) => void;
  patchGain: (patch: PidGainPatch) => void;
  resetGains: () => void;
  pushFrame: (frame: PIDDebugFrame) => void;
  clearFrames: () => void;
};

function cloneDefaults(): PIDControllerGains {
  return JSON.parse(JSON.stringify(DEFAULT_PID_GAINS)) as PIDControllerGains;
}

export const usePidStore = create<PidStoreState>((set) => ({
  gains: cloneDefaults(),
  frames: [],
  setGains: (next) => set({ gains: next }),
  patchGain: (patch) =>
    set((s) => {
      const gains = cloneDefaults();
      Object.assign(gains, s.gains);
      gains.altitude = { ...s.gains.altitude };
      gains.horizontalX = { ...s.gains.horizontalX };
      gains.horizontalZ = { ...s.gains.horizontalZ };
      gains.attitudePitch = { ...s.gains.attitudePitch };
      gains.attitudeYaw = { ...s.gains.attitudeYaw };
      if (patch.kind === "loop") {
        const loop = { ...gains[patch.loop] };
        // outputClamp / integralClamp are tuples; the panel doesn't expose
        // them yet — guard against accidental scalar writes to those keys.
        if (patch.field === "outputClamp" || patch.field === "integralClamp") {
          return { gains };
        }
        (loop as unknown as Record<string, number>)[patch.field as string] = patch.value;
        gains[patch.loop] = loop;
      } else {
        (gains as unknown as Record<string, number>)[patch.field as string] = patch.value;
      }
      return { gains };
    }),
  resetGains: () => set({ gains: cloneDefaults() }),
  pushFrame: (frame) =>
    set((s) => {
      const next = s.frames.length >= FRAME_BUFFER_CAP ? s.frames.slice(1) : s.frames.slice();
      next.push(frame);
      return { frames: next };
    }),
  clearFrames: () => set({ frames: [] }),
}));
