/**
 * Unit tests for `OverrideController` — the multiplexer that lets the
 * player grab the stick during an auto-fly run (SLS-24).
 */

import { describe, expect, it } from "vitest";

import { OverrideController, type OverrideMode } from "./overrideController.js";
import type { Controller } from "./types.js";
import { BoosterDescentCalm } from "@starship-catch-sim/physics";
import type { ControlInput, World } from "@starship-catch-sim/physics";

function makeStub(label: number): Controller {
  return {
    step: () => ({ tag: label }) as unknown as ControlInput,
  };
}

function worldAt(t: number): World {
  return { ...BoosterDescentCalm.initialWorld, t };
}

describe("OverrideController", () => {
  it("uses primary when no manual input is active", () => {
    const primary = makeStub(1);
    const manual = makeStub(2);
    const ctl = new OverrideController({
      primary,
      manual,
      isManualActive: () => false,
      overrideDurationS: 2,
      getMode: () => "temporary",
    });
    expect((ctl.step(worldAt(0), 0.004) as unknown as { tag: number }).tag).toBe(1);
  });

  it("hands control to manual for `overrideDurationS` after a manual nudge in temporary mode", () => {
    let manualActive = false;
    const mode: OverrideMode = "temporary";
    const ctl = new OverrideController({
      primary: makeStub(1),
      manual: makeStub(2),
      isManualActive: () => manualActive,
      overrideDurationS: 2,
      getMode: () => mode,
    });
    manualActive = true;
    expect((ctl.step(worldAt(10), 0.004) as unknown as { tag: number }).tag).toBe(2);
    manualActive = false;
    expect((ctl.step(worldAt(11), 0.004) as unknown as { tag: number }).tag).toBe(2);
    // After 2 s from the last nudge → primary returns.
    expect((ctl.step(worldAt(13), 0.004) as unknown as { tag: number }).tag).toBe(1);
    expect(mode).toBe("temporary");
  });

  it("pins control to manual forever in hard mode until release()", () => {
    let manualActive = false;
    const ctl = new OverrideController({
      primary: makeStub(1),
      manual: makeStub(2),
      isManualActive: () => manualActive,
      overrideDurationS: 2,
      getMode: () => "hard",
    });
    manualActive = true;
    expect((ctl.step(worldAt(0), 0.004) as unknown as { tag: number }).tag).toBe(2);
    manualActive = false;
    expect((ctl.step(worldAt(1000), 0.004) as unknown as { tag: number }).tag).toBe(2);
    ctl.release();
    expect((ctl.step(worldAt(2000), 0.004) as unknown as { tag: number }).tag).toBe(1);
  });

  it("fires onTransition on edges only", () => {
    let manualActive = false;
    const transitions: boolean[] = [];
    const ctl = new OverrideController({
      primary: makeStub(1),
      manual: makeStub(2),
      isManualActive: () => manualActive,
      overrideDurationS: 1,
      getMode: () => "temporary",
      onTransition: (a) => transitions.push(a),
    });
    ctl.step(worldAt(0), 0.004);
    manualActive = true;
    ctl.step(worldAt(0.1), 0.004);
    manualActive = false;
    ctl.step(worldAt(0.5), 0.004); // still in override window
    ctl.step(worldAt(2), 0.004); // override window expired
    expect(transitions).toEqual([true, false]);
  });
});
