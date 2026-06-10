/**
 * HUD value formatters. Units-aware (metric or imperial) — controlled
 * by the `hudStore.units` field.
 */

import type { Units } from "../state/hudStore";

const M_PER_FT = 0.3048;
const MS_PER_FTS = 0.3048;
const KG_PER_LB = 0.45359237;

const RAD2DEG = 180 / Math.PI;

export function formatLength(m: number, units: Units, digits = 1): string {
  if (units === "metric") return `${m.toFixed(digits)} m`;
  return `${(m / M_PER_FT).toFixed(digits)} ft`;
}

export function formatSpeed(mps: number, units: Units, digits = 1): string {
  if (units === "metric") return `${mps.toFixed(digits)} m/s`;
  return `${(mps / MS_PER_FTS).toFixed(digits)} ft/s`;
}

export function formatMass(kg: number, units: Units): string {
  if (units === "metric") return `${formatThousand(kg)} kg`;
  return `${formatThousand(kg / KG_PER_LB)} lb`;
}

export function formatMach(m: number): string {
  return `M${m.toFixed(2)}`;
}

export function formatBearing(rad: number): string {
  let deg = (rad * RAD2DEG) % 360;
  if (deg < 0) deg += 360;
  return `${deg.toFixed(0).padStart(3, "0")}°`;
}

export function formatAngleDeg(rad: number, digits = 1): string {
  return `${(rad * RAD2DEG).toFixed(digits)}°`;
}

export function formatPercent(frac: number, digits = 0): string {
  return `${(frac * 100).toFixed(digits)}%`;
}

function formatThousand(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
