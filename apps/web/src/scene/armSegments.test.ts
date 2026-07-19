import { BufferGeometry, Float32BufferAttribute, Mesh } from "three";
import { describe, expect, it } from "vitest";

import { segmentChain } from "./armSegments";

/** A ~30 m beam along X, thin in Y/Z — stands in for a chopstick arm. */
function beamMesh(): Mesh {
  const positions: number[] = [];
  for (let x = 0; x <= 30; x += 1) positions.push(x, 0, 0, x, 1, 0.5);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return new Mesh(geo);
}

describe("segmentChain (SLS-84)", () => {
  it("slices a beam into ≤ n short boxes along its long axis", () => {
    const boxes = segmentChain(beamMesh(), 10);
    expect(boxes.length).toBeGreaterThan(1);
    expect(boxes.length).toBeLessThanOrEqual(10);
    // Each box is short in X relative to the 30 m beam — the chain, not one box.
    for (const b of boxes) expect(b.halfExtents.x).toBeLessThan(5);
  });

  it("does not throw for n<=0 (clamps to 1)", () => {
    expect(() => segmentChain(beamMesh(), 0)).not.toThrow();
    expect(segmentChain(beamMesh(), -3)).toHaveLength(1);
  });

  it("inflate grows every box half-extent by the margin", () => {
    const tight = segmentChain(beamMesh(), 5, 0);
    const fat = segmentChain(beamMesh(), 5, 4.5);
    expect(fat).toHaveLength(tight.length);
    for (let i = 0; i < tight.length; i++) {
      expect(fat[i]!.halfExtents.y).toBeCloseTo(tight[i]!.halfExtents.y + 4.5);
      expect(fat[i]!.halfExtents.z).toBeCloseTo(tight[i]!.halfExtents.z + 4.5);
    }
  });
});
