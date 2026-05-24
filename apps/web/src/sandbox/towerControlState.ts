export type TowerControlState = {
  /** Chopstick opening [0=closed, 1=wide open]. */
  opening: number;
  /** Arm carriage Y position on the tower (m). */
  armHeight: number;
  /** Booster Y position (m) — drag the booster up/down to see the catch. */
  boosterY: number;
  /** Booster throttle [0, 1]. */
  boosterThrottle: number;
  /** Show debug helpers (hard-point markers, target indicator). */
  debug: boolean;
};

export const DEFAULT_TOWER_STATE: TowerControlState = {
  opening: 1,
  armHeight: 95,
  boosterY: 95,
  boosterThrottle: 0.6,
  debug: true,
};
