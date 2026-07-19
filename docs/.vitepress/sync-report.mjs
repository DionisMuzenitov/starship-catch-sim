// Sync the committed controller-comparison report into the docs site.
//
// The canonical benchmark artifact lives at eval/reports/v1-controller-comparison.md
// (committed, generated during SLS-30; referenced by the root README). It sits
// OUTSIDE docs/, so VitePress can't route it directly. This copies it to
// docs/benchmarks.md (gitignored) before dev/build, keeping a single source of
// truth. Re-run automatically by the `dev` / `build` scripts.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const src = resolve(repoRoot, "eval/reports/v1-controller-comparison.md");
const dest = resolve(here, "..", "benchmarks.md");

const banner = `---
title: Benchmarks
---

::: info Generated artifact
This page is synced verbatim from [\`eval/reports/v1-controller-comparison.md\`](https://github.com/DionisMuzenitov/starship-catch-sim/blob/main/eval/reports/v1-controller-comparison.md),
the committed benchmark report. Regenerate the underlying numbers with the eval
harness (\`pnpm eval:all\`) and refresh that file; this page follows.
:::

`;

if (!existsSync(src)) {
  // Don't hard-fail the site build if the report is absent — emit a placeholder
  // so the Benchmarks route still resolves.
  console.warn(`[sync-report] source not found: ${src} — writing placeholder`);
  writeFileSync(
    dest,
    `${banner}# Benchmarks\n\n_The controller-comparison report is not available in this checkout._\n`,
  );
} else {
  // The report lives in eval/reports/, so its relative `../foo` links point at
  // eval/foo (e.g. ../results/gate-records/...). Those resolve on GitHub but not
  // as docs-site routes, so rewrite them to absolute GitHub blob URLs — the
  // raw-data links then actually work on the hosted site.
  const GH_BLOB = `${"https://github.com/DionisMuzenitov/starship-catch-sim"}/blob/main/eval/`;
  const body = readFileSync(src, "utf8").replace(/\]\(\.\.\//g, `](${GH_BLOB}`);
  writeFileSync(dest, banner + body);
  console.log(`[sync-report] ${src} -> ${dest}`);
}
