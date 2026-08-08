/**
 * Docs-freshness check (SLS-107).
 *
 * The project's numbers live in ONE place — the committed gate records
 * (`eval/results/gate-records/`) — but are quoted in prose (README, ADRs,
 * eval reports). Twice that prose went stale for a full milestone (M6 README,
 * SLS-63) or flatly contradicted the records (ADR-023's "the MPC catches 0 %",
 * found by the 2026-07-25 audit). This check makes that drift a CI failure,
 * mirroring the `gen:consts:check` idiom: docs that quote a benchmark number
 * must agree with the committed record.
 *
 * Four checks:
 *  1. README "## Results" table cells == gate-record success rates (rounded %,
 *     columns matched by scenario calm/standard/stormy, rows by generation).
 *  2. ADR index (docs/adr/README.md) status column is consistent with each
 *     ADR file's own `- **Status:**` line (Proposed/Accepted/Superseded
 *     classification + bijection between files and index rows).
 *  3. Bench-claim sweep: prose of the form "<controller> … catches N %"
 *     (single number, ranges "87–90 %", slash lists "87 / 87 / 90 %", and
 *     possessives "MPC's 53 / 50 / 50 %") across every git-tracked Markdown
 *     file in README/docs/eval must quote numbers from that controller's
 *     committed record. Hard-wrapped lines are unwrapped per paragraph, so a
 *     claim split across lines is still seen. Opt-out: a
 *     `docs-check:ignore <reason>` marker on the claim's own line, or a
 *     standalone marker comment on the line directly above.
 *  4. Prose denylist (SLS-114): known-wrong phrases tied to settled decisions
 *     ("PPO-/SAC-trained" for the imitation-learned policy; "uses ONNX" post-
 *     ADR-016) fail loudly even when they quote no number — the class that
 *     shipped green before (the docs site's "trained with PPO"). Same
 *     `docs-check:ignore` opt-out. A floor, not completeness — a keyword lint
 *     can't judge arbitrary prose; see PROSE_DENYLIST.
 *
 * The controller registry (labels, aliases, record files) is single-sourced
 * from `tools/eval/generations.ts`, shared with the progression chart — a new
 * generation added there is automatically covered here.
 *
 * Run: `pnpm docs:check` (exits non-zero on any failure). Runs in CI.
 * The Jira-side freshness guard (SLS-43 snapshot date) needs credentials CI
 * doesn't have — that lives in `tools/loop-check.sh` (`pnpm loop:check`).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GENERATIONS,
  SCENARIOS,
  loadGateCells,
  ratesByScenario,
} from "./eval/generations";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..");

export type Failure = { file: string; detail: string };

// ---------------------------------------------------------------------------
// Canonical rates from the committed gate records
// ---------------------------------------------------------------------------

/** Rounded success percentages per generation label, in calm/standard/stormy
 *  order — matched by scenarioId (or the M5 windScale fallback), never by the
 *  record's cell emission order. */
export function canonicalRates(root: string): Record<string, number[]> {
  const gateDir = join(root, "eval/results/gate-records");
  const out: Record<string, number[]> = {};
  for (const g of GENERATIONS) {
    const rates = ratesByScenario(loadGateCells(gateDir, g.file));
    out[g.label] = SCENARIOS.map((s) => Math.round(rates[s] * 100));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Check 1 — README "## Results" table vs gate records
// ---------------------------------------------------------------------------

/** The `## Results` section only (heading to the next `## `), so a row lookup
 *  can never latch onto a different table that mentions a controller (the
 *  milestone table's "| M5 | Convex MPC guidance …" row, for example). */
export function resultsSection(readme: string): string | null {
  const m = /^## Results\b.*$/m.exec(readme);
  if (!m || m.index === undefined) return null;
  const afterHeading = readme.indexOf("\n", m.index);
  if (afterHeading === -1) return null;
  const next = readme.indexOf("\n## ", afterHeading);
  return readme.slice(m.index, next === -1 ? undefined : next);
}

export function checkReadmeResultsTable(
  readme: string,
  canon: Record<string, number[]>,
): Failure[] {
  const failures: Failure[] = [];
  const section = resultsSection(readme);
  if (section === null) {
    return [{ file: "README.md", detail: 'no "## Results" section found — the results table moved or was renamed; update tools/docs-check.ts if intentional' }];
  }
  for (const g of GENERATIONS) {
    const names = [g.label, ...g.aliases];
    const row = section
      .split("\n")
      .find((l) => l.startsWith("|") && names.some((n) => l.includes(n)));
    if (!row) {
      failures.push({ file: "README.md", detail: `Results table row for "${g.label}" not found` });
      continue;
    }
    const cells = [...row.matchAll(/(\d+)\s?%/g)].map((m) => Number(m[1]));
    const expected = canon[g.label];
    if (cells.length !== expected.length) {
      failures.push({
        file: "README.md",
        detail: `"${g.label}" row has ${cells.length} % cells, gate record has ${expected.length} (${SCENARIOS.join("/")})`,
      });
      continue;
    }
    cells.forEach((got, i) => {
      if (got !== expected[i]) {
        failures.push({
          file: "README.md",
          detail: `"${g.label}" ${SCENARIOS[i]} column: README says ${got} %, gate record says ${expected[i]} % — update whichever is stale (they must move together)`,
        });
      }
    });
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Check 2 — ADR index vs per-file Status lines
// ---------------------------------------------------------------------------

export type StatusClass = "accepted" | "proposed" | "superseded" | "unknown";

export function classifyStatus(status: string): StatusClass {
  const t = status.toLowerCase();
  if (t.includes("supersed")) return "superseded";
  if (t.includes("proposed")) return "proposed";
  if (t.includes("accepted")) return "accepted";
  return "unknown";
}

export function checkAdrIndex(root: string): Failure[] {
  const failures: Failure[] = [];
  const adrDir = join(root, "docs/adr");
  const index = readFileSync(join(adrDir, "README.md"), "utf8");

  // Index rows: | 007 | [Title](007-file.md) | Status text |
  const rows = new Map<string, { file: string; status: string }>();
  for (const m of index.matchAll(/^\|\s*(\d{3})\s*\|\s*\[[^\]]+\]\(([^)]+)\)\s*\|\s*([^|]+?)\s*\|/gm)) {
    rows.set(m[1], { file: m[2], status: m[3] });
  }

  const files = readdirSync(adrDir).filter((f) => /^\d{3}-.+\.md$/.test(f));
  for (const file of files) {
    const num = file.slice(0, 3);
    const body = readFileSync(join(adrDir, file), "utf8");
    const statusLine = body.match(/^- \*\*Status:\*\*\s*(.+)$/m);
    if (!statusLine) {
      failures.push({ file: `docs/adr/${file}`, detail: "no `- **Status:**` line found" });
      continue;
    }
    const row = rows.get(num);
    if (!row) {
      failures.push({ file: "docs/adr/README.md", detail: `ADR ${num} (${file}) missing from the index table` });
      continue;
    }
    if (row.file !== file) {
      failures.push({ file: "docs/adr/README.md", detail: `index row ${num} links "${row.file}" but the file is "${file}"` });
    }
    const fileClass = classifyStatus(statusLine[1]);
    const indexClass = classifyStatus(row.status);
    if (fileClass !== indexClass) {
      failures.push({
        file: "docs/adr/README.md",
        detail: `ADR ${num} status drift: index says "${row.status}" (${indexClass}), file says "${statusLine[1]}" (${fileClass})`,
      });
    }
  }
  for (const num of rows.keys()) {
    if (!files.some((f) => f.startsWith(num))) {
      failures.push({ file: "docs/adr/README.md", detail: `index row ${num} has no matching ADR file` });
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Check 3 — bench-claim sweep
// ---------------------------------------------------------------------------

/** Opt-out marker. Exempts claims STARTING on the marker's own line, or — when
 *  a line is a standalone marker comment — claims starting on the next line.
 *  Deliberately narrow: an inline end-of-line marker does not bleed onto the
 *  following line, so edits below a marked line stay checked. */
export const IGNORE_MARKER = "docs-check:ignore";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Longest-first so "neural policy" wins over "policy"-less prefixes etc.
const TOKENS = GENERATIONS.flatMap((g) => [g.label, ...g.aliases])
  .sort((a, b) => b.length - a.length)
  .map(escapeRe)
  .join("|");

/** token -> generation label, case-insensitive. */
const TOKEN_TO_LABEL = new Map<string, string>(
  GENERATIONS.flatMap((g) => [g.label, ...g.aliases].map((t) => [t.toLowerCase(), g.label] as const)),
);

/** Number forms: "87", "87–90", "53 / 50 / 50" (any mix of -, –, —, /). */
const NUM_LIST = String.raw`\d+(?:\s*[–—/-]\s*\d+)*`;

/** "<controller> … catches/gets/scores <numbers> %". Gaps exclude '.'/'%'/newline,
 *  so a claim never crosses a sentence, an earlier percentage, or a paragraph
 *  break (paragraphs are the only place newlines survive unwrapping). */
const VERB_CLAIM_RE = new RegExp(
  String.raw`\b(${TOKENS})\b[^.\n%]{0,40}?\b(?:catches|gets|scores)\b[^.\n%]{0,25}?(${NUM_LIST})\s?%`,
  "gi",
);

/** "<controller>'s <numbers> %" — the possessive claim form ("MPC's 53 / 50 / 50 %"). */
const POSSESSIVE_CLAIM_RE = new RegExp(
  String.raw`\b(${TOKENS})['’]s\s+(${NUM_LIST})\s?%`,
  "gi",
);

/** Unwrap hard-wrapped Markdown so a claim split across source lines is still
 *  one match: within a paragraph, lines join with spaces; blank lines become
 *  the only surviving newlines (paragraph barriers for the regexes). HTML
 *  comments are stripped from the shadow text (their prose is not a claim),
 *  while marker detection below reads the ORIGINAL lines. Returns the shadow
 *  text plus a per-character map back to the source line. */
export function unwrapWithLineMap(text: string): { shadow: string; lineOf: number[] } {
  const lines = text.split("\n");
  let shadow = "";
  const lineOf: number[] = [];
  const push = (s: string, line: number) => {
    for (const ch of s) {
      shadow += ch;
      lineOf.push(line);
    }
  };
  lines.forEach((raw, i) => {
    const line = raw.replace(/<!--.*?-->/g, "");
    if (line.trim() === "") push("\n", i);
    else push(`${line} `, i);
  });
  return { shadow, lineOf };
}

function isStandaloneMarker(line: string | undefined): boolean {
  if (line === undefined) return false;
  const t = line.trim();
  return t.startsWith("<!--") && t.includes(IGNORE_MARKER);
}

/** Scan one file's text for controller-percentage claims whose numbers are not
 *  all in that controller's committed record. */
export function sweepBenchClaims(
  file: string,
  text: string,
  canon: Record<string, number[]>,
): Failure[] {
  const failures: Failure[] = [];
  const lines = text.split("\n");
  const { shadow, lineOf } = unwrapWithLineMap(text);
  for (const re of [VERB_CLAIM_RE, POSSESSIVE_CLAIM_RE]) {
    re.lastIndex = 0;
    for (const m of shadow.matchAll(re)) {
      const startLine = lineOf[m.index];
      if (lines[startLine].includes(IGNORE_MARKER)) continue;
      if (isStandaloneMarker(lines[startLine - 1])) continue;
      const label = TOKEN_TO_LABEL.get(m[1].toLowerCase());
      if (label === undefined || canon[label] === undefined) continue;
      const allowed = new Set(canon[label]);
      const quoted = m[2].split(/[–—/-]/).map((n) => Number(n.trim()));
      for (const n of quoted) {
        if (!allowed.has(n)) {
          failures.push({
            file,
            detail: `line ${startLine + 1}: claims ${m[1]} catches ${n} %, but the committed "${label}" gate record says ${canon[label].join("/")} % — fix the prose or (if deliberately historical) add a \`${IGNORE_MARKER} <reason>\` marker`,
          });
        }
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Check 4 — prose denylist (SLS-114)
// ---------------------------------------------------------------------------

/**
 * Known-wrong phrases tied to SETTLED decisions. Check 3 only catches prose
 * that quotes a contradicting *number*; a flatly-wrong sentence with no number
 * (the docs site's "trained with PPO" — the exact inverse of the load-bearing
 * "imitation-learned; PPO/SAC failed" claim — shipped green under checks 1–3)
 * sails through. This denylist makes those *known* contradictions fail loudly.
 *
 * Each pattern is deliberately narrow: it matches only the AFFIRMATIVE wrong
 * claim, never the negation or the historical/attempt prose the docs are full
 * of ("not RL-trained", "no ONNX runtime", ADR-014's "trains a PPO policy"
 * describing the *failed* attempt). Calibrated to zero matches on the current
 * tree — see docs-check.test.ts. When a phrase is a deliberate historical or
 * negative mention the pattern can't distinguish, exempt it with the SAME
 * `docs-check:ignore <reason>` marker check 3 uses.
 *
 * This can never be complete (a keyword lint can't judge arbitrary prose) — it
 * is a floor that nails the worst, most-repeated contradictions cheaply.
 */
export const PROSE_DENYLIST: { id: string; re: RegExp; why: string }[] = [
  {
    id: "policy-rl-provenance",
    // "PPO-trained" / "SAC-trained" / "trained with|via|using|by PPO|SAC|
    // reinforcement learning". Does NOT match "not RL-trained" (the docs'
    // negation uses "RL-trained", not "PPO-/SAC-trained") nor "trains a PPO
    // policy" (ADR-014 describing the failed attempt).
    re: /\b(?:PPO|SAC)[-\s]trained\b|\btrained\s+(?:with|via|using|by)\s+(?:PPO|SAC|reinforcement learning)\b/gi,
    why: 'the shipped neural policy is IMITATION-learned (behaviour cloning on a scripted-cascade teacher); direct PPO/SAC never produced a catching policy (ADR-015/016, README). Claiming it was PPO/SAC/RL-*trained* inverts the load-bearing result. If you mean a failed training attempt, phrase it that way; if it is a deliberate historical note, add a `docs-check:ignore <reason>` marker',
  },
  {
    id: "onnx-runtime",
    // Affirmative "uses|using|via|runs on ONNX" only. Does NOT match "no ONNX",
    // "no ONNX runtime", "exported to ONNX", "load ONNX weights", or the
    // "ONNX/onnxruntime-web plan" — all legitimate negations / historical ADR
    // prose (ADR-001/003/016).
    re: /\b(?:uses?|using|via|through|runs?\s+on)\s+ONNX\b/gi,
    why: 'the in-browser policy runtime is a dependency-free TypeScript forward pass, NOT ONNX — ADR-016 superseded the ONNX/onnxruntime-web plan. If this is a historical reference, add a `docs-check:ignore <reason>` marker',
  },
];

/** Scan one file's text for known-wrong denylisted phrases (Check 4). Honors
 *  the same ignore-marker semantics as the bench-claim sweep. */
export function sweepProseDenylist(file: string, text: string): Failure[] {
  const failures: Failure[] = [];
  const lines = text.split("\n");
  const { shadow, lineOf } = unwrapWithLineMap(text);
  for (const { id, re, why } of PROSE_DENYLIST) {
    re.lastIndex = 0;
    for (const m of shadow.matchAll(re)) {
      const startLine = lineOf[m.index];
      if (lines[startLine].includes(IGNORE_MARKER)) continue;
      if (isStandaloneMarker(lines[startLine - 1])) continue;
      failures.push({
        file,
        detail: `line ${startLine + 1}: known-wrong phrase "${m[0].trim()}" [${id}] — ${why}`,
      });
    }
  }
  return failures;
}

/** Markdown files the sweep covers: git-TRACKED files under README/docs/eval.
 *  Tracked-only keeps local and CI runs identical — it skips docs/node_modules
 *  (docs is a workspace member), gitignored generated files (docs build
 *  output), and directories that don't exist on a fresh clone. */
export function sweepTargets(root: string): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--", "README.md", "docs", "eval"], {
    cwd: root,
    encoding: "utf8",
  });
  return out
    .split("\0")
    .filter((f) => f.endsWith(".md"))
    .filter((f) => existsSync(join(root, f)));
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export function runAllChecks(root: string): Failure[] {
  const canon = canonicalRates(root);
  const failures: Failure[] = [
    ...checkReadmeResultsTable(readFileSync(join(root, "README.md"), "utf8"), canon),
    ...checkAdrIndex(root),
  ];
  for (const path of sweepTargets(root)) {
    const text = readFileSync(join(root, path), "utf8");
    failures.push(...sweepBenchClaims(path, text, canon));
    failures.push(...sweepProseDenylist(path, text));
  }
  return failures;
}

function main(): void {
  const failures = runAllChecks(repoRoot);
  if (failures.length === 0) {
    console.log("docs:check OK — README table, ADR index, bench claims, and prose denylist agree with the gate records + settled decisions");
    return;
  }
  console.error(`docs:check FAILED — ${failures.length} doc-freshness problem(s):\n`);
  for (const f of failures) console.error(`  ${f.file}: ${f.detail}`);
  console.error(
    "\nDocs quoting benchmark numbers must match eval/results/gate-records/ — update them together.",
  );
  process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].endsWith("docs-check.ts");
if (invokedDirectly) main();
