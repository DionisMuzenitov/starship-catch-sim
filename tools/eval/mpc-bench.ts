/**
 * SLS-27 — MPC benchmark suite. A LOCAL/DEV tool (not CI-gated): it needs
 * the Python guidance service already running.
 *
 *   pnpm mpc:serve          # terminal 1
 *   pnpm bench:mpc          # terminal 2 (add --quick for a fast pass)
 *
 * Benches:
 *  a. Solve-time distribution (p50/p99 over warm re-plans) for the linear
 *     lossless SOCP vs SCvx at the baked-in horizon N=60. A solve-time-vs-N
 *     sweep is DEFERRED: N is compiled into the parametric problem, and a
 *     per-N problem factory isn't worth building yet (see ADR-008).
 *  b. Success-rate vs wind scale (0/1/2×) on booster-descent-calm for the
 *     cascaded PID baseline vs MPC(+PID fallback) over real HTTP, via the
 *     async MC runner. MPC runs pause sim time until each in-flight solve
 *     lands (ADR-007's "solver keeps up with the 1 Hz cadence" assumption).
 *
 * Outputs: JSON reports to eval/results/ (success reports use the same
 * shape as run-eval.ts, so `pnpm plot` can consume them too) and SVGs to
 * eval/plots/ (zero-dep, same rationale as tools/eval/plot.ts).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEFAULT_PID_GAINS,
  MPCController,
  PIDController,
  runMonteCarloAsync,
  type MPCSolveRequest,
  type MPCSolveResponse,
  type MonteCarloResult,
} from "../../packages/controllers/src/index.js";

const DEFAULT_URL = "http://localhost:8100";

// Warm-re-plan IC for the solve-time bench: the drag-feasible final-descent
// case from services/mpc/tests (2091 m, −160 m/s — hot enough that the
// thrust floor is not binding once SCvx models drag).
const BENCH_REQUEST: MPCSolveRequest = {
  position: { x: 50, y: 2091, z: 300 },
  velocity: { x: -5, y: -160, z: -40 },
  massKg: 240_000,
  vehicle: {
    dryMassKg: 200_000,
    maxThrustN: 29.9e6,
    minThrustN: 2.76e6,
    ispS: 340,
  },
};

type BenchSolveResponse = MPCSolveResponse & {
  iterations?: number | null;
  converged?: boolean | null;
};

type Args = {
  quick: boolean;
  url: string;
  /** Seeds per (controller, wind) cell; overrides the mode default.
   *  The SLS-47 gate is 30 seeds: `pnpm bench:mpc --seeds 30`. */
  seeds: number | null;
};

function parseArgs(argv: string[]): Args {
  const urlIdx = argv.indexOf("--url");
  const seedsIdx = argv.indexOf("--seeds");
  const seedsRaw = seedsIdx >= 0 ? Number(argv[seedsIdx + 1]) : NaN;
  return {
    quick: argv.includes("--quick"),
    url: urlIdx >= 0 && argv[urlIdx + 1] ? argv[urlIdx + 1]! : DEFAULT_URL,
    seeds: Number.isInteger(seedsRaw) && seedsRaw > 0 ? seedsRaw : null,
  };
}

function isoStamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

async function solve(
  url: string,
  req: MPCSolveRequest & { mode?: "linear" | "scvx" },
): Promise<BenchSolveResponse> {
  const resp = await fetch(`${url}/solve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!resp.ok) throw new Error(`MPC service HTTP ${resp.status}`);
  return (await resp.json()) as BenchSolveResponse;
}

// ---------------------------------------------------------------------------
// Zero-dep SVG line chart (same styling family as tools/eval/plot.ts).
// ---------------------------------------------------------------------------

type ChartSeries = { label: string; points: { x: number; y: number }[] };
type ChartSpec = {
  title: string;
  xLabel: string;
  yLabel: string;
  series: ChartSeries[];
  yMax?: number;
  yTickFmt?: (v: number) => string;
};

const COLORS = ["#7dd3fc", "#fbbf24", "#34d399", "#f472b6", "#a78bfa"];

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderLineChart(spec: ChartSpec): string {
  const W = 720;
  const H = 360;
  const PAD_L = 70;
  const PAD_R = 200;
  const PAD_T = 32;
  const PAD_B = 48;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  let xMax = 0;
  let yMax = spec.yMax ?? 0;
  for (const s of spec.series) {
    for (const p of s.points) {
      xMax = Math.max(xMax, p.x);
      if (spec.yMax === undefined) yMax = Math.max(yMax, p.y);
    }
  }
  if (xMax === 0) xMax = 1;
  if (yMax === 0) yMax = 1;
  const x = (v: number) => PAD_L + (v / xMax) * plotW;
  const y = (v: number) => PAD_T + plotH - (v / yMax) * plotH;
  const fmt = spec.yTickFmt ?? ((v: number) => v.toFixed(1));

  const grid: string[] = [];
  for (let i = 0; i <= 5; i++) {
    const xv = (i / 5) * xMax;
    const yv = (i / 5) * yMax;
    grid.push(
      `<line x1="${x(xv)}" y1="${PAD_T}" x2="${x(xv)}" y2="${PAD_T + plotH}" stroke="#ffffff20" />`,
      `<text x="${x(xv)}" y="${PAD_T + plotH + 14}" fill="#aaa" font-size="10" text-anchor="middle">${xv.toFixed(1)}</text>`,
      `<line x1="${PAD_L}" y1="${y(yv)}" x2="${PAD_L + plotW}" y2="${y(yv)}" stroke="#ffffff20" />`,
      `<text x="${PAD_L - 6}" y="${y(yv) + 3}" fill="#aaa" font-size="10" text-anchor="end">${fmt(yv)}</text>`,
    );
  }

  const lines: string[] = [];
  const legend: string[] = [];
  spec.series.forEach((s, i) => {
    const color = COLORS[i % COLORS.length]!;
    const path = s.points
      .map(
        (p, j) =>
          `${j === 0 ? "M" : "L"} ${x(p.x).toFixed(1)} ${y(p.y).toFixed(1)}`,
      )
      .join(" ");
    lines.push(
      `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" />`,
    );
    for (const p of s.points) {
      lines.push(
        `<circle cx="${x(p.x).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="3" fill="${color}" />`,
      );
    }
    const ly = PAD_T + 8 + i * 16;
    legend.push(
      `<rect x="${PAD_L + plotW + 12}" y="${ly}" width="10" height="10" fill="${color}" />`,
      `<text x="${PAD_L + plotW + 28}" y="${ly + 9}" fill="#ddd" font-size="11">${escapeXml(s.label)}</text>`,
    );
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0c1117" />
  <text x="${W / 2}" y="20" fill="#eee" font-size="14" text-anchor="middle" font-family="sans-serif">${escapeXml(spec.title)}</text>
  <text x="${PAD_L + plotW / 2}" y="${H - 10}" fill="#aaa" font-size="11" text-anchor="middle">${escapeXml(spec.xLabel)}</text>
  <text x="14" y="${PAD_T + plotH / 2}" fill="#aaa" font-size="11" text-anchor="middle" transform="rotate(-90 14 ${PAD_T + plotH / 2})">${escapeXml(spec.yLabel)}</text>
  <rect x="${PAD_L}" y="${PAD_T}" width="${plotW}" height="${plotH}" fill="none" stroke="#ffffff40" />
  ${grid.join("\n  ")}
  ${lines.join("\n  ")}
  ${legend.join("\n  ")}
</svg>`;
}

// ---------------------------------------------------------------------------
// Bench a: solve-time distribution, linear vs scvx, N=60.
// ---------------------------------------------------------------------------

type SolveTimeSeries = {
  mode: "linear" | "scvx";
  solveTimesMs: number[];
  roundTripMs: number[];
  p50Ms: number;
  p99Ms: number;
  iterations?: number[];
};

async function benchSolveTime(
  url: string,
  replans: number,
): Promise<SolveTimeSeries[]> {
  const out: SolveTimeSeries[] = [];
  for (const mode of ["linear", "scvx"] as const) {
    const solveTimes: number[] = [];
    const roundTrips: number[] = [];
    const iterations: number[] = [];
    let tFHint: number | undefined;
    // Cold solve to warm the parametric problem / pick t_f, not counted.
    const cold = await solve(url, { ...BENCH_REQUEST, mode });
    tFHint = cold.tFS;
    for (let i = 0; i < replans; i++) {
      const t0 = performance.now();
      const resp = await solve(url, {
        ...BENCH_REQUEST,
        mode,
        tFHintS: tFHint,
      });
      roundTrips.push(performance.now() - t0);
      solveTimes.push(resp.solveTimeMs);
      if (typeof resp.iterations === "number")
        iterations.push(resp.iterations);
      if (resp.status !== "optimal")
        throw new Error(`bench solve failed: ${mode} → ${resp.status}`);
      tFHint = resp.tFS;
    }
    out.push({
      mode,
      solveTimesMs: solveTimes,
      roundTripMs: roundTrips,
      p50Ms: percentile(solveTimes, 0.5),
      p99Ms: percentile(solveTimes, 0.99),
      iterations: iterations.length > 0 ? iterations : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bench b: success-rate vs wind, PID vs MPC over real HTTP.
// ---------------------------------------------------------------------------

/** Same report shape as tools/eval/run-eval.ts so `pnpm plot` groks it. */
type EvalRunReport = {
  controllerKey: string;
  controllerLabel: string;
  generatedAt: string;
  seedsPerCell: number;
  cells: MonteCarloResult[];
};

async function benchSuccessVsWind(
  url: string,
  windScales: readonly number[],
  seeds: number,
  stamp: string,
): Promise<EvalRunReport[]> {
  const scenarioId = "booster-descent-calm";
  const reports: EvalRunReport[] = [];

  // --- PID baseline ---
  const pidCells: MonteCarloResult[] = [];
  for (const windScale of windScales) {
    pidCells.push(
      await runMonteCarloAsync({
        scenarioId,
        nRuns: seeds,
        environment: { windScale },
        controllerFactory: (scenario) =>
          new PIDController(
            scenario.vehicle,
            scenario.targetCatch.targetPosition,
            () => DEFAULT_PID_GAINS,
          ),
      }),
    );
    logCell("pid", windScale, pidCells[pidCells.length - 1]!);
  }
  reports.push({
    controllerKey: "pid",
    controllerLabel: "Cascaded PID (default gains)",
    generatedAt: stamp,
    seedsPerCell: seeds,
    cells: pidCells,
  });

  // --- MPC over real HTTP, sim time paused while a solve is in flight ---
  const mpcCells: MonteCarloResult[] = [];
  for (const windScale of windScales) {
    let inFlight: Promise<unknown> | null = null;
    mpcCells.push(
      await runMonteCarloAsync({
        scenarioId,
        nRuns: seeds,
        environment: { windScale },
        controllerFactory: (scenario) =>
          new MPCController({
            vehicle: scenario.vehicle,
            targetPosition: scenario.targetCatch.targetPosition,
            transport: (req) => {
              const p = solve(url, req);
              inFlight = p.catch(() => undefined);
              return p;
            },
          }),
        onSimSecond: async () => {
          await inFlight;
          inFlight = null;
        },
      }),
    );
    logCell("mpc", windScale, mpcCells[mpcCells.length - 1]!);
  }
  reports.push({
    controllerKey: "mpc",
    controllerLabel: "MPC (linear SOCP, PID fallback)",
    generatedAt: stamp,
    seedsPerCell: seeds,
    cells: mpcCells,
  });

  return reports;
}

function logCell(key: string, windScale: number, cell: MonteCarloResult): void {
  const s = cell.summary;
  console.log(
    `  ${key.padEnd(4)} wind ${windScale.toFixed(1)}  success ${(s.successRate * 100)
      .toFixed(0)
      .padStart(3)} %  medErr ${s.medianFinalPosErrM.toFixed(0)} m  medFuel ${s.medianFuelKg.toFixed(0)} kg`,
  );
}

// ---------------------------------------------------------------------------

async function checkHealth(url: string): Promise<boolean> {
  try {
    const resp = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!(await checkHealth(args.url))) {
    console.error(
      `MPC service unreachable at ${args.url}.\n` +
        `Start it first:\n\n  pnpm mpc:serve\n\n` +
        `then re-run: pnpm bench:mpc${args.quick ? " --quick" : ""}`,
    );
    process.exitCode = 1;
    return;
  }

  const stamp = isoStamp();
  const resultsDir = resolve(process.cwd(), "eval/results");
  const plotsDir = resolve(process.cwd(), "eval/plots");
  mkdirSync(resultsDir, { recursive: true });
  mkdirSync(plotsDir, { recursive: true });

  const replans = args.quick ? 10 : 30;
  const windScales = args.quick ? [0, 1] : [0, 1, 2];
  const seeds = args.seeds ?? (args.quick ? 2 : 5);

  // --- a) solve time ---
  console.log(`\n[a] solve-time distribution (${replans} warm re-plans, N=60)`);
  const solveSeries = await benchSolveTime(args.url, replans);
  for (const s of solveSeries) {
    const iters =
      s.iterations !== undefined
        ? `  iterations p50 ${percentile(s.iterations, 0.5)}`
        : "";
    console.log(
      `  ${s.mode.padEnd(6)} p50 ${s.p50Ms.toFixed(1)} ms  p99 ${s.p99Ms.toFixed(1)} ms` +
        `  (round-trip p50 ${percentile(s.roundTripMs, 0.5).toFixed(1)} ms)${iters}`,
    );
  }
  const solveJson = resolve(resultsDir, `mpc-bench-solvetime-${stamp}.json`);
  writeFileSync(
    solveJson,
    JSON.stringify({ generatedAt: stamp, replans, n: 60, series: solveSeries }, null, 2),
  );
  const solveSvg = resolve(plotsDir, "mpc-solve-time.svg");
  writeFileSync(
    solveSvg,
    renderLineChart({
      title: "MPC solve time per warm re-plan (N=60)",
      xLabel: "re-plan index",
      yLabel: "solver time (ms)",
      yTickFmt: (v) => v.toFixed(0),
      series: solveSeries.map((s) => ({
        label: `${s.mode} (p50 ${s.p50Ms.toFixed(1)} / p99 ${s.p99Ms.toFixed(1)} ms)`,
        points: s.solveTimesMs.map((y, i) => ({ x: i + 1, y })),
      })),
    }),
  );
  console.log(`  wrote ${solveJson}\n  wrote ${solveSvg}`);

  // --- b) success vs wind ---
  console.log(
    `\n[b] success rate vs wind (booster-descent-calm, ${seeds} seeds/cell)`,
  );
  const reports = await benchSuccessVsWind(args.url, windScales, seeds, stamp);
  for (const r of reports) {
    const file = resolve(resultsDir, `mpc-bench-${r.controllerKey}-${stamp}.json`);
    writeFileSync(file, JSON.stringify(r, null, 2));
    console.log(`  wrote ${file}`);
  }
  const successSvg = resolve(plotsDir, "mpc-bench-success.svg");
  writeFileSync(
    successSvg,
    renderLineChart({
      title: "PID vs MPC — success rate vs wind (booster-descent-calm)",
      xLabel: "wind scale (× scenario default)",
      yLabel: "success rate",
      yMax: 1,
      yTickFmt: (v) => `${(v * 100).toFixed(0)} %`,
      series: reports.map((r) => ({
        label: r.controllerLabel,
        points: r.cells.map((c) => ({
          x: c.windScale,
          y: c.summary.successRate,
        })),
      })),
    }),
  );
  console.log(`  wrote ${successSvg}`);

  // Grouped table.
  console.log("\ncontroller   " + windScales.map((w) => `wind ${w}×`.padStart(9)).join(""));
  for (const r of reports) {
    console.log(
      `${r.controllerKey.padEnd(12)} ` +
        r.cells
          .map((c) => `${(c.summary.successRate * 100).toFixed(0)} %`.padStart(9))
          .join(""),
    );
  }
}

void main();
