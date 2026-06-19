import {
  BoosterDescentStandard,
  type CatchOutcome,
  type Replay,
  type World,
} from "@starship-catch-sim/physics";
import { create } from "zustand";

/**
 * Render-side view of the simulator state. The runner writes here once
 * per requestAnimationFrame; UI components subscribe to the fields they
 * care about. Direct mutation is forbidden — go through the setters.
 *
 * `outcome` is the run's terminal verdict — `null` while the rocket is
 * still in the air; populated exactly once when the catch detector fires
 * (caught / near_miss / tower_collision / crash). The `CatchOutcomeOverlay`
 * subscribes to it and renders the post-attempt panel.
 */
export type SimState = {
  world: World;
  t: number;
  paused: boolean;
  scale: number;
  outcome: CatchOutcome | null;
  /** Frozen replay of the most recent attempt. Set when the runner fires
   *  its terminal outcome; consumed by the post-attempt "Save .json"
   *  button and re-set to `null` when the scene re-mounts. */
  lastReplay: Replay | null;
  setWorld: (world: World) => void;
  setPaused: (paused: boolean) => void;
  setScale: (scale: number) => void;
  setT: (t: number) => void;
  setOutcome: (outcome: CatchOutcome | null) => void;
  setLastReplay: (replay: Replay | null) => void;
};

const initial = BoosterDescentStandard.initialWorld;

export const useSimStore = create<SimState>((set) => ({
  world: initial,
  t: 0,
  paused: true,
  scale: 1,
  outcome: null,
  lastReplay: null,
  setWorld: (world) => set({ world, t: world.t }),
  setPaused: (paused) => set({ paused }),
  setScale: (scale) => set({ scale }),
  setT: (t) => set({ t }),
  setOutcome: (outcome) => set({ outcome }),
  setLastReplay: (lastReplay) => set({ lastReplay }),
}));
