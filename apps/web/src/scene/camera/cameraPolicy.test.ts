import { describe, expect, it } from "vitest";

import type { CameraMode } from "../../state/cameraStore";

import { isOrbitMode, isRigMode, MODE_POLICY } from "./cameraPolicy";

const ALL_MODES: readonly CameraMode[] = [
  "chase",
  "tower",
  "ground",
  "free",
  "onboard",
  "cinematic",
];

describe("cameraPolicy (SLS-58)", () => {
  it("assigns a policy to every camera mode", () => {
    for (const mode of ALL_MODES) {
      expect(MODE_POLICY[mode]).toBeDefined();
    }
    // No stray keys beyond the known modes.
    expect(Object.keys(MODE_POLICY).sort()).toEqual([...ALL_MODES].sort());
  });

  it("focused cams orbit-track, ground/free orbit-free, scripted cams rig", () => {
    expect(MODE_POLICY.chase).toBe("orbit-track");
    expect(MODE_POLICY.tower).toBe("orbit-track");
    expect(MODE_POLICY.ground).toBe("orbit-free");
    expect(MODE_POLICY.free).toBe("orbit-free");
    expect(MODE_POLICY.onboard).toBe("rig");
    expect(MODE_POLICY.cinematic).toBe("rig");
  });

  it("isOrbitMode is true iff OrbitControls owns the camera", () => {
    expect(isOrbitMode("chase")).toBe(true);
    expect(isOrbitMode("tower")).toBe(true);
    expect(isOrbitMode("ground")).toBe(true);
    expect(isOrbitMode("free")).toBe(true);
    expect(isOrbitMode("onboard")).toBe(false);
    expect(isOrbitMode("cinematic")).toBe(false);
  });

  it("isRigMode is the complement of isOrbitMode", () => {
    for (const mode of ALL_MODES) {
      expect(isRigMode(mode)).toBe(!isOrbitMode(mode));
    }
    expect(isRigMode("onboard")).toBe(true);
    expect(isRigMode("cinematic")).toBe(true);
    expect(isRigMode("chase")).toBe(false);
  });
});
