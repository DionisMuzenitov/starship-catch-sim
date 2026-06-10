/**
 * Active scenario selection. Picker UI writes; `useSimRunner` reads at
 * construction; Scene remounts via `key={currentScenarioId}` on change.
 */

import { BoosterDescentStandard } from "@starship-catch-sim/physics";
import { create } from "zustand";

export type ScenarioState = {
  currentScenarioId: string;
  setScenarioId: (id: string) => void;
};

export const useScenarioStore = create<ScenarioState>((set) => ({
  currentScenarioId: BoosterDescentStandard.id,
  setScenarioId: (id) => set({ currentScenarioId: id }),
}));
