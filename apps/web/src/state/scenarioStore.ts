/**
 * Active scenario selection. Picker UI writes; `useSimRunner` reads at
 * construction; Scene remounts via `key={`${currentScenarioId}-${epoch}`}`.
 *
 * `epoch` lets the outcome overlay re-mount the scene on the SAME scenario
 * (a "reset" of the current run) by bumping the counter; `setScenarioId`
 * also bumps it when the id changes for free, since the resulting key
 * combines both fields.
 */

import { BoosterDescentStandard } from "@starship-catch-sim/physics";
import { create } from "zustand";

export type ScenarioState = {
  currentScenarioId: string;
  epoch: number;
  setScenarioId: (id: string) => void;
  /** Re-mount the scene on the current scenario (e.g. "Reset"). */
  resetCurrent: () => void;
};

export const useScenarioStore = create<ScenarioState>((set) => ({
  currentScenarioId: BoosterDescentStandard.id,
  epoch: 0,
  setScenarioId: (id) =>
    set((s) => ({ currentScenarioId: id, epoch: s.epoch + 1 })),
  resetCurrent: () => set((s) => ({ epoch: s.epoch + 1 })),
}));
