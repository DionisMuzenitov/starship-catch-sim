import { describe, expect, it } from "vitest";

import {
  formatAngleDeg,
  formatBearing,
  formatLength,
  formatMach,
  formatMass,
  formatPercent,
  formatSpeed,
} from "./formatters";

describe("formatters", () => {
  it("metric vs imperial length", () => {
    expect(formatLength(100, "metric")).toBe("100.0 m");
    expect(formatLength(100, "imperial")).toBe("328.1 ft");
  });
  it("metric vs imperial speed", () => {
    expect(formatSpeed(20, "metric")).toBe("20.0 m/s");
    expect(formatSpeed(20, "imperial")).toBe("65.6 ft/s");
  });
  it("metric vs imperial mass", () => {
    expect(formatMass(1000, "metric")).toBe("1,000 kg");
    expect(formatMass(1000, "imperial")).toMatch(/2,2\d{2} lb/);
  });
  it("mach + percent + angle + bearing", () => {
    expect(formatMach(1.234)).toBe("M1.23");
    expect(formatPercent(0.45)).toBe("45%");
    expect(formatAngleDeg(Math.PI / 2)).toBe("90.0°");
    expect(formatBearing(0)).toBe("000°");
    expect(formatBearing(Math.PI / 2)).toBe("090°");
    expect(formatBearing(-Math.PI / 2)).toBe("270°");
  });
});
