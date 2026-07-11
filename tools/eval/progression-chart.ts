/**
 * North-star progression chart (SLS-72).
 *
 * Renders the project's defining number — booster catch rate — as a trend
 * across controller generations: PID (M4) -> convex MPC (M5) -> imitation-
 * learned neural policy (M6), broken out by wind scenario (calm/standard/
 * stormy). Reads the *committed gate-record* JSONs (SLS-67) so the figure is
 * always sourced from the numbers that met each milestone gate — never a
 * fresh, unpinned bench run.
 *
 *   pnpm chart:progression        # regenerate docs/media/progression.svg
 *
 * Regenerate whenever a new milestone gate lands a gate-record (add the new
 * generation to GENERATIONS below). Grouped-bar form; colour encodes wind
 * scenario as an ordinal blue ramp (darker = harsher wind), validated
 * colourblind-safe. Self-contained light card so it reads on any page theme.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../..");
const gateDir = join(repo, "eval/results/gate-records");

type Scenario = "calm" | "standard" | "stormy";
const SCENARIOS: Scenario[] = ["calm", "standard", "stormy"];

/** Ordinal blue ramp — calm (light) -> stormy (dark). Validated:
 *  monotone L, adjacent ΔL > 0.06, light end 2.06:1 on the #fcfcfb surface. */
const SCENARIO_COLOR: Record<Scenario, string> = {
  calm: "#86b6ef",
  standard: "#2a78d6",
  stormy: "#104281",
};

interface Generation {
  label: string;
  milestone: string;
  /** committed gate-record file holding this generation's winning bench */
  file: string;
}

// One entry per controller generation, oldest -> newest. Append a row when a
// new milestone gate lands its gate-record.
const GENERATIONS: Generation[] = [
  { label: "PID", milestone: "M4", file: "m6-rl-bench-pid-30seed.json" },
  { label: "MPC", milestone: "M5", file: "m5-mpc-bench-mpc-30seed.json" },
  {
    label: "Neural policy",
    milestone: "M6",
    file: "m6-rl-bench-rl-30seed.json",
  },
];

interface Cell {
  scenarioId: string;
  windScale: number;
  summary: { successRate: number };
}

/** Gate records come in two shapes: a `{...meta, cells}` object (mpc-bench)
 *  or a bare cell array (rl-bench). Normalise to the cell list. */
function loadCells(file: string): Cell[] {
  const raw = JSON.parse(readFileSync(join(gateDir, file), "utf8"));
  return Array.isArray(raw) ? raw : raw.cells;
}

/** Map a generation's cells to a {calm,standard,stormy} success-rate record.
 *  Prefer the scenarioId suffix; when every cell shares one scenarioId (the
 *  M5 bench varies wind by windScale, not id) fall back to windScale
 *  0/1/2 -> calm/standard/stormy. */
function ratesByScenario(cells: Cell[]): Record<Scenario, number> {
  const uniqueIds = new Set(cells.map((c) => c.scenarioId));
  const out = {} as Record<Scenario, number>;
  const byWind: Record<number, Scenario> = {
    0: "calm",
    1: "standard",
    2: "stormy",
  };
  for (const c of cells) {
    let scen: Scenario | undefined;
    if (uniqueIds.size > 1) {
      scen = SCENARIOS.find((s) => c.scenarioId.endsWith(s));
    } else {
      scen = byWind[c.windScale];
    }
    if (!scen)
      throw new Error(`cannot bucket cell ${c.scenarioId}/${c.windScale}`);
    out[scen] = c.summary.successRate;
  }
  for (const s of SCENARIOS) {
    if (out[s] === undefined) throw new Error(`missing scenario ${s}`);
  }
  return out;
}

// --- ink & geometry (reference-palette chrome, light surface) ---
const INK = {
  surface: "#fcfcfb",
  border: "rgba(11,11,11,0.10)",
  primary: "#0b0b0b",
  secondary: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  baseline: "#c3c2b7",
};
// single-quoted inner family name — this string lands inside a double-quoted
// SVG attribute, so "Segoe UI" with double quotes would break the XML.
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

const W = 660;
const H = 400;
const M = { top: 70, right: 22, bottom: 78, left: 52 };
const plotW = W - M.left - M.right;
const plotH = H - M.top - M.bottom;
const baseY = M.top + plotH;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildSvg(
  data: { gen: Generation; rates: Record<Scenario, number> }[],
): string {
  const groupW = plotW / data.length;
  const barGap = 3;
  const groupPad = groupW * 0.16;
  const bandW = groupW - 2 * groupPad;
  const barW = (bandW - barGap * (SCENARIOS.length - 1)) / SCENARIOS.length;

  const parts: string[] = [];

  // card
  parts.push(
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="${INK.surface}" stroke="${INK.border}"/>`,
  );
  // title + subtitle
  parts.push(
    `<text x="${M.left}" y="30" font-family="${FONT}" font-size="17" font-weight="600" fill="${INK.primary}">Booster catch rate by controller generation</text>`,
  );
  parts.push(
    `<text x="${M.left}" y="49" font-family="${FONT}" font-size="12.5" fill="${INK.secondary}">30-seed Monte-Carlo per cell · standard catch envelope · TS physics core</text>`,
  );

  // y gridlines + labels (0,25,50,75,100 %)
  for (const pct of [0, 25, 50, 75, 100]) {
    const y = baseY - (pct / 100) * plotH;
    const isBase = pct === 0;
    parts.push(
      `<line x1="${M.left}" y1="${y.toFixed(1)}" x2="${M.left + plotW}" y2="${y.toFixed(1)}" stroke="${isBase ? INK.baseline : INK.grid}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${M.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-family="${FONT}" font-size="11.5" fill="${INK.muted}" font-variant-numeric="tabular-nums">${pct}%</text>`,
    );
  }

  // bars per generation group
  data.forEach(({ gen, rates }, gi) => {
    const gx = M.left + gi * groupW + groupPad;
    SCENARIOS.forEach((scen, si) => {
      const rate = rates[scen];
      const x = gx + si * (barW + barGap);
      const h = rate * plotH;
      const y = baseY - h;
      const color = SCENARIO_COLOR[scen];
      const pctLabel = `${Math.round(rate * 100)}%`;
      if (h >= 1) {
        // rounded top (4px), squared base — clamp radius on short bars
        const r = Math.min(4, h);
        parts.push(
          `<path d="M${x.toFixed(1)},${baseY} V${(y + r).toFixed(1)} Q${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)} H${(x + barW - r).toFixed(1)} Q${(x + barW).toFixed(1)},${y.toFixed(1)} ${(x + barW).toFixed(1)},${(y + r).toFixed(1)} V${baseY} Z" fill="${color}"/>`,
        );
      }
      // value label above the bar (0% sits just above the baseline)
      const ly = h >= 1 ? y - 6 : baseY - 6;
      parts.push(
        `<text x="${(x + barW / 2).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="11.5" font-weight="600" fill="${INK.secondary}" font-variant-numeric="tabular-nums">${pctLabel}</text>`,
      );
    });
    // x group label: generation + milestone
    const cx = M.left + gi * groupW + groupW / 2;
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${baseY + 22}" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="600" fill="${INK.primary}">${esc(gen.label)}</text>`,
    );
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${baseY + 38}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${INK.muted}">${esc(gen.milestone)}</text>`,
    );
  });

  // legend (scenario identity — colour is never alone; bars are labelled too)
  const legY = H - 16;
  let lx = M.left;
  for (const scen of SCENARIOS) {
    parts.push(
      `<rect x="${lx}" y="${legY - 9}" width="11" height="11" rx="2.5" fill="${SCENARIO_COLOR[scen]}"/>`,
    );
    parts.push(
      `<text x="${lx + 16}" y="${legY}" font-family="${FONT}" font-size="12" fill="${INK.secondary}">${scen} wind</text>`,
    );
    lx += 16 + scen.length * 7.3 + 34;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" ` +
    `aria-label="Booster catch rate by controller generation: PID 0% across all wind scenarios, MPC 53/50/50%, neural policy 87/87/90% (calm/standard/stormy).">` +
    parts.join("") +
    `</svg>\n`
  );
}

function main() {
  const data = GENERATIONS.map((gen) => ({
    gen,
    rates: ratesByScenario(loadCells(gen.file)),
  }));

  const outDir = join(repo, "docs/media");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "progression.svg");
  writeFileSync(outPath, buildSvg(data));

  console.log("wrote docs/media/progression.svg");
  for (const { gen, rates } of data) {
    console.log(
      `  ${gen.label.padEnd(14)} (${gen.milestone})  ` +
        SCENARIOS.map(
          (s) => `${s} ${(rates[s] * 100).toFixed(0).padStart(3)}%`,
        ).join("  "),
    );
  }
}

main();
