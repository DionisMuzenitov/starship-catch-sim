import { describe, expect, it } from "vitest";

import {
  MODEL_SCALE,
  azimuthOf,
  enginePlaneOffsetY,
  sanitizeName,
} from "./assetTransform";

describe("asset transform (SLS-44)", () => {
  it("offsets a vehicle's engine plane to the frame origin", () => {
    // A part at the engine-plane height, after scale+offset, lands at y=0.
    const planeY = 63.26; // ship engine plane (model units)
    const rendered = MODEL_SCALE * planeY + enginePlaneOffsetY(planeY);
    expect(rendered).toBeCloseTo(0, 6);
  });

  it("keeps a part above the engine plane above origin", () => {
    const planeY = 0.08; // booster engine plane
    const finY = 60.78; // grid-fin height (model units)
    const rendered = MODEL_SCALE * finY + enginePlaneOffsetY(planeY);
    expect(rendered).toBeGreaterThan(60); // ~65 m up the booster
  });

  it("azimuth maps the four diagonal fin mounts to distinct angles", () => {
    const a = azimuthOf(2.34, -3.61); // +x −z
    const b = azimuthOf(-1.98, -3.62); // −x −z
    const c = azimuthOf(2.31, 3.93); // +x +z
    const d = azimuthOf(-2.0, 3.92); // −x +z
    const angles = [a, b, c, d];
    // All four distinct.
    expect(new Set(angles.map((x) => x.toFixed(3))).size).toBe(4);
  });

  it("sanitizeName matches three's GLTFLoader rewriting", () => {
    // whitespace → underscore, reserved chars [ ] . : / stripped
    expect(sanitizeName("Superheavy V4_37")).toBe("Superheavy_V4_37");
    expect(sanitizeName("Gridfin.001_21")).toBe("Gridfin001_21");
    expect(sanitizeName("Raptor 2 Engine.003_24")).toBe("Raptor_2_Engine003_24");
    expect(sanitizeName("Aft Flaps.001_3")).toBe("Aft_Flaps001_3");
  });
});
