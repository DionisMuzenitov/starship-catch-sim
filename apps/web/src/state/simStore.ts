import {
  boosterDescentScenario,
  type World,
} from "@starship-catch-sim/physics";
import { create } from "zustand";

/**
 * Render-side view of the simulator state. The runner writes here once
 * per requestAnimationFrame; UI components subscribe to the fields they
 * care about. Direct mutation is forbidden — go through the setters.
 *
 * In v1 the booster vehicle is fixed at scenario load. Multiple vehicles
 * land in a later ticket.
 */
export type SimState = {
  world: World;
  t: number;
  paused: boolean;
  scale: number;
  setWorld: (world: World) => void;
  setPaused: (paused: boolean) => void;
  setScale: (scale: number) => void;
  setT: (t: number) => void;
};

const initial = boosterDescentScenario().initialWorld;

export const useSimStore = create<SimState>((set) => ({
  world: initial,
  t: 0,
  paused: true,
  scale: 1,
  setWorld: (world) => set({ world, t: world.t }),
  setPaused: (paused) => set({ paused }),
  setScale: (scale) => set({ scale }),
  setT: (t) => set({ t }),
}));
