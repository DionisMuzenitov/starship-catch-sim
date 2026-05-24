export type ControlState = {
  /** Common booster throttle [0, 1]. */
  boosterThrottle: number;
  /** Common ship throttle [0, 1]. */
  shipThrottle: number;
  /** Booster fin deflections in rad, length 4. */
  finDeflections: [number, number, number, number];
  /** Ship flap deflections in rad, length 4. */
  flapDeflections: [number, number, number, number];
  /** Altitude factor [0, 1] — 0 sea level, 1 vacuum. */
  altitudeFactor: number;
  /** Both vehicles' engines on. */
  enginesOn: boolean;
};

export const DEFAULT_CONTROL_STATE: ControlState = {
  boosterThrottle: 0.6,
  shipThrottle: 0.6,
  finDeflections: [0, 0, 0, 0],
  flapDeflections: [0, 0, 0, 0],
  altitudeFactor: 0,
  enginesOn: true,
};
