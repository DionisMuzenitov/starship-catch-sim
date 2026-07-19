import { describe, expect, it } from "vitest";

import type { CameraMode } from "../../state/cameraStore";

import {
  isFreeLookMode,
  isOrbitMode,
  isRigMode,
  MODE_POLICY,
} from "./cameraPolicy";

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

  it("maps each mode to its control scheme", () => {
    expect(MODE_POLICY.chase).toBe("orbit-follow");
    expect(MODE_POLICY.tower).toBe("orbit-fixed");
    expect(MODE_POLICY.ground).toBe("look");
    expect(MODE_POLICY.free).toBe("fly");
    expect(MODE_POLICY.onboard).toBe("rig");
    expect(MODE_POLICY.cinematic).toBe("rig");
  });

  it("isOrbitMode is true for the OrbitControls cams (chase / tower)", () => {
    expect(isOrbitMode("chase")).toBe(true);
    expect(isOrbitMode("tower")).toBe(true);
    expect(isOrbitMode("ground")).toBe(false);
    expect(isOrbitMode("free")).toBe(false);
    expect(isOrbitMode("onboard")).toBe(false);
  });

  it("isFreeLookMode is true for the first-person cams (ground / free)", () => {
    expect(isFreeLookMode("ground")).toBe(true);
    expect(isFreeLookMode("free")).toBe(true);
    expect(isFreeLookMode("chase")).toBe(false);
    expect(isFreeLookMode("onboard")).toBe(false);
  });

  it("every mode has exactly one owner: rig xor orbit xor free-look", () => {
    for (const mode of ALL_MODES) {
      const owners = [isRigMode(mode), isOrbitMode(mode), isFreeLookMode(mode)];
      expect(owners.filter(Boolean)).toHaveLength(1);
    }
    expect(isRigMode("onboard")).toBe(true);
    expect(isRigMode("cinematic")).toBe(true);
    expect(isRigMode("chase")).toBe(false);
  });
});
