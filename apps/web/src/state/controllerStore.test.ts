import { describe, expect, it } from "vitest";

import {
  controllerUnavailableReason,
  isShipScenario,
  type ControllerKind,
} from "./controllerStore";

describe("controller guard (SLS-96)", () => {
  it("recognises ship scenarios by id convention", () => {
    expect(isShipScenario("ship-descent-calm")).toBe(true);
    expect(isShipScenario("ship-descent-stormy")).toBe(true);
    expect(isShipScenario("booster-descent-standard")).toBe(false);
    expect(isShipScenario("")).toBe(false);
  });

  it("disables Neural + MPC on ship scenarios (booster-only), leaves Manual/PID", () => {
    for (const kind of ["rl", "mpc"] as ControllerKind[]) {
      expect(controllerUnavailableReason("ship-descent-calm", kind)).toBe(
        "booster-only",
      );
    }
    for (const kind of ["manual", "pid"] as ControllerKind[]) {
      expect(controllerUnavailableReason("ship-descent-calm", kind)).toBeNull();
    }
  });

  it("never disables anything on booster scenarios", () => {
    for (const kind of ["manual", "pid", "mpc", "rl"] as ControllerKind[]) {
      expect(
        controllerUnavailableReason("booster-descent-standard", kind),
      ).toBeNull();
    }
  });
});
