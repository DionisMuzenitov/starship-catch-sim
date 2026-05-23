import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Smoke tests that verify the testing stack is wired up.
// Real math/physics tests land in SLS-7.
describe("testing stack sanity", () => {
  it("vitest runs", () => {
    expect(1 + 1).toBe(2);
  });

  it("fast-check runs property tests", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => a + b === b + a),
    );
  });
});
