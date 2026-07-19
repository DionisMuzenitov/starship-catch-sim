import { describe, expect, it } from "vitest";

import {
  clampPitch,
  forwardFromYawPitch,
  MAX_PITCH,
  rightFromYaw,
  yawPitchFromDir,
} from "./freeLookMath";

describe("freeLookMath (SLS-58)", () => {
  it("yaw/pitch 0 looks toward -Z (default camera forward)", () => {
    const f = forwardFromYawPitch(0, 0);
    expect(f.x).toBeCloseTo(0, 6);
    expect(f.y).toBeCloseTo(0, 6);
    expect(f.z).toBeCloseTo(-1, 6);
  });

  it("yaw +90° looks toward +X", () => {
    const f = forwardFromYawPitch(Math.PI / 2, 0);
    expect(f.x).toBeCloseTo(1, 6);
    expect(f.z).toBeCloseTo(0, 6);
  });

  it("forwardFromYawPitch and yawPitchFromDir round-trip", () => {
    for (const dir of [
      { x: -101.5, y: 77, z: -70 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0.5, z: -1 },
      { x: 3, y: -2, z: 4 },
    ]) {
      const { yaw, pitch } = yawPitchFromDir(dir.x, dir.y, dir.z);
      const f = forwardFromYawPitch(yaw, pitch);
      const len = Math.hypot(dir.x, dir.y, dir.z);
      expect(f.x).toBeCloseTo(dir.x / len, 5);
      expect(f.y).toBeCloseTo(dir.y / len, 5);
      expect(f.z).toBeCloseTo(dir.z / len, 5);
    }
  });

  it("right is perpendicular to forward and horizontal", () => {
    for (const yaw of [0, 0.7, Math.PI / 2, 2.5]) {
      const f = forwardFromYawPitch(yaw, 0);
      const r = rightFromYaw(yaw);
      expect(r.y).toBe(0);
      expect(f.x * r.x + f.y * r.y + f.z * r.z).toBeCloseTo(0, 6);
    }
  });

  it("clampPitch bounds the pitch to ±MAX_PITCH", () => {
    expect(clampPitch(10)).toBeCloseTo(MAX_PITCH, 6);
    expect(clampPitch(-10)).toBeCloseTo(-MAX_PITCH, 6);
    expect(clampPitch(0.3)).toBeCloseTo(0.3, 6);
  });
});
