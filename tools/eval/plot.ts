/**
 * SLS-24 — plot eval results as a "success rate vs wind intensity" SVG
 * per scenario, one line per controller. Reads every JSON report under
 * `eval/results/` and writes one SVG per scenario to `eval/plots/`.
 *
 *   pnpm plot
 *
 * The ticket asks for PNG; we emit SVG to keep this script zero-dependency
 * (no `canvas` / native `cairo` build chain in CI). GitHub renders SVG in
 * markdown so the plot is still embeddable in PR / wiki write-ups. Swap
 * to PNG-via-`vega-cli` later if the writeup needs raster.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { MonteCarloResult } from "../../packages/controllers/src/index.js";

type Report = {
  controllerKey: string;
  controllerLabel: string;
  generatedAt: string;
  seedsPerCell: number;
  cells: MonteCarloResult[];
};

const COLORS = ["#7dd3fc", "#fbbf24", "#34d399", "#f472b6", "#a78bfa"];

function loadReports(dir: string): Report[] {
  const reports: Report[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return reports;
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const text = readFileSync(resolve(dir, name), "utf8");
    reports.push(JSON.parse(text) as Report);
  }
  return reports;
}

/**
 * Group cells by scenarioId, and within each scenario by controller.
 * Returns { scenarioId → { controllerKey → [{windScale, successRate}…] } }.
 */
function pivot(reports: Report[]): Map<
  string,
  Map<string, { label: string; points: { windScale: number; successRate: number }[] }>
> {
  const out = new Map<
    string,
    Map<string, { label: string; points: { windScale: number; successRate: number }[] }>
  >();
  for (const r of reports) {
    for (const cell of r.cells) {
      const byScenario = out.get(cell.scenarioId) ?? new Map();
      const series = byScenario.get(r.controllerKey) ?? {
        label: r.controllerLabel,
        points: [],
      };
      series.points.push({
        windScale: cell.windScale,
        successRate: cell.summary.successRate,
      });
      byScenario.set(r.controllerKey, series);
      out.set(cell.scenarioId, byScenario);
    }
  }
  for (const byScenario of out.values()) {
    for (const series of byScenario.values()) {
      series.points.sort((a, b) => a.windScale - b.windScale);
    }
  }
  return out;
}

type Series = { label: string; points: { windScale: number; successRate: number }[] };

function renderSvg(scenarioId: string, byController: Map<string, Series>): string {
  const W = 720;
  const H = 360;
  const PAD_L = 70;
  const PAD_R = 200;
  const PAD_T = 32;
  const PAD_B = 48;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  let xMax = 0;
  for (const s of byController.values()) {
    for (const p of s.points) xMax = Math.max(xMax, p.windScale);
  }
  if (xMax === 0) xMax = 1;
  const x = (v: number) => PAD_L + (v / xMax) * plotW;
  const y = (v: number) => PAD_T + plotH - v * plotH;

  const gridXTicks = 5;
  const gridYTicks = 5;
  const gridLines: string[] = [];
  for (let i = 0; i <= gridXTicks; i++) {
    const v = (i / gridXTicks) * xMax;
    const xp = x(v);
    gridLines.push(
      `<line x1="${xp}" y1="${PAD_T}" x2="${xp}" y2="${PAD_T + plotH}" stroke="#ffffff20" />`,
      `<text x="${xp}" y="${PAD_T + plotH + 14}" fill="#aaa" font-size="10" text-anchor="middle">${v.toFixed(1)}</text>`,
    );
  }
  for (let i = 0; i <= gridYTicks; i++) {
    const v = i / gridYTicks;
    const yp = y(v);
    gridLines.push(
      `<line x1="${PAD_L}" y1="${yp}" x2="${PAD_L + plotW}" y2="${yp}" stroke="#ffffff20" />`,
      `<text x="${PAD_L - 6}" y="${yp + 3}" fill="#aaa" font-size="10" text-anchor="end">${(v * 100).toFixed(0)} %</text>`,
    );
  }

  const seriesLines: string[] = [];
  const legend: string[] = [];
  let colorIdx = 0;
  for (const [key, series] of byController) {
    const color = COLORS[colorIdx % COLORS.length]!;
    colorIdx++;
    const path = series.points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.windScale).toFixed(1)} ${y(p.successRate).toFixed(1)}`)
      .join(" ");
    seriesLines.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="2" />`);
    for (const p of series.points) {
      seriesLines.push(
        `<circle cx="${x(p.windScale).toFixed(1)}" cy="${y(p.successRate).toFixed(1)}" r="3" fill="${color}" />`,
      );
    }
    const ly = PAD_T + 8 + (colorIdx - 1) * 16;
    legend.push(
      `<rect x="${PAD_L + plotW + 12}" y="${ly}" width="10" height="10" fill="${color}" />`,
      `<text x="${PAD_L + plotW + 28}" y="${ly + 9}" fill="#ddd" font-size="11">${escapeXml(`${series.label} (${key})`)}</text>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0c1117" />
  <text x="${W / 2}" y="20" fill="#eee" font-size="14" text-anchor="middle" font-family="sans-serif">${escapeXml(scenarioId)} — success rate vs wind scale</text>
  <text x="${PAD_L + plotW / 2}" y="${H - 10}" fill="#aaa" font-size="11" text-anchor="middle">wind scale (× scenario default)</text>
  <text x="14" y="${PAD_T + plotH / 2}" fill="#aaa" font-size="11" text-anchor="middle" transform="rotate(-90 14 ${PAD_T + plotH / 2})">success rate</text>
  <rect x="${PAD_L}" y="${PAD_T}" width="${plotW}" height="${plotH}" fill="none" stroke="#ffffff40" />
  ${gridLines.join("\n  ")}
  ${seriesLines.join("\n  ")}
  ${legend.join("\n  ")}
</svg>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderEvalPlots(resultsDir: string, outDir: string): string[] {
  const reports = loadReports(resultsDir);
  if (reports.length === 0) {
    return [];
  }
  mkdirSync(outDir, { recursive: true });
  const grouped = pivot(reports);
  const written: string[] = [];
  for (const [scenarioId, byController] of grouped) {
    const svg = renderSvg(scenarioId, byController);
    const file = resolve(outDir, `${scenarioId}.svg`);
    writeFileSync(file, svg);
    written.push(file);
  }
  return written;
}

function main(): void {
  const resultsDir = resolve(process.cwd(), "eval/results");
  const outDir = resolve(process.cwd(), "eval/plots");
  const written = renderEvalPlots(resultsDir, outDir);
  if (written.length === 0) {
    console.error(
      `No reports found in ${resultsDir}. Run \`pnpm eval:all\` first.`,
    );
    process.exitCode = 1;
    return;
  }
  for (const file of written) console.log(`wrote ${file}`);
}

const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("plot.ts");
if (invokedDirectly) main();
