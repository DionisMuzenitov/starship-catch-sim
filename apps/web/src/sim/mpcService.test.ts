import { describe, expect, it } from "vitest";

import { resolveMpcServiceUrl } from "./mpcService";

describe("resolveMpcServiceUrl (SLS-49)", () => {
  it("falls back to the local dev service when unset", () => {
    expect(resolveMpcServiceUrl(undefined)).toBe("http://localhost:8100");
  });

  it("treats an empty string as service-absent (static host signal)", () => {
    expect(resolveMpcServiceUrl("")).toBeNull();
    expect(resolveMpcServiceUrl("   ")).toBeNull();
  });

  it("passes through an explicit URL (custom host / tunnel)", () => {
    expect(resolveMpcServiceUrl("https://mpc.example.com")).toBe(
      "https://mpc.example.com",
    );
  });
});
