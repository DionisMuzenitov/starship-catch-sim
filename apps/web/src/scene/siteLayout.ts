/**
 * Measured launch-site layout constants (SLS-57, lidar-derived). Kept in a
 * plain, React-free module so both the scene (`LaunchSite.tsx`) and the sim
 * runner's collision geometry (`sim/siteCollision.ts`) can import them without
 * dragging R3F/three into the runner's module graph (SLS-79 review).
 *
 * Frame: origin = tower base, +X = east, −Z = north, metres.
 */

// OLM centre measured at (18, −21) (2023 lidar).
export const OLM_POS_X = 18;
export const OLM_POS_Z = -21;
/** OLM deck height (m) — coarse massing of the ~18–21 m Pad-A-era mount. */
export const OLM_DECK_HEIGHT_M = 18;
export const OLM_RING_RADIUS_M = 7.5;
