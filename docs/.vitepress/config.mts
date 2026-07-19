import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitepress";

const here = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = resolve(here, "..");
const REPO = "https://github.com/DionisMuzenitov/starship-catch-sim";
const APP_URL = "https://dionismuzenitov.github.io/starship-catch-sim/";

/**
 * Auto-list the ADRs (SLS-32 AC: "All ADRs auto-listed via filesystem walk").
 * ADRs are `docs/adr/NNN-slug.md` with a `# ADR-NNN: Title` heading and no
 * frontmatter, so we read the dir, skip the index + template, parse the title
 * from the first heading, and sort by number.
 */
function adrSidebarItems() {
  const dir = resolve(DOCS_ROOT, "adr");
  return readdirSync(dir)
    .filter(
      (f) => f.endsWith(".md") && f !== "README.md" && f !== "template.md",
    )
    .sort() // NNN- zero-padded prefix sorts numerically
    .map((file) => {
      const first = readFileSync(resolve(dir, file), "utf8")
        .split("\n")
        .find((l) => l.startsWith("# "));
      const text = first ? first.replace(/^#\s+/, "").trim() : file;
      return { text, link: `/adr/${file.replace(/\.md$/, "")}` };
    });
}

// GitHub Pages serves this project-repo docs under /starship-catch-sim/docs/;
// the deploy workflow sets DOCS_BASE_PATH. Local dev/build leave it unset → "/".
const base = process.env.DOCS_BASE_PATH ?? "/";

export default defineConfig({
  base,
  title: "Starship Catch Simulator",
  description:
    "Open-source 6-DOF browser simulation of the Super Heavy booster catch — physics, controllers (PID / MPC / RL), and the derivations behind them.",
  lang: "en-US",
  cleanUrls: true,
  lastUpdated: true,
  // VitePress doesn't treat README.md as a directory index, so map the two
  // committed section indexes to their `/adr/` and `/reference/` roots (rather
  // than renaming files that GitHub also renders).
  rewrites: {
    "adr/README.md": "adr/index.md",
    "reference/README.md": "reference/index.md",
  },
  // Some committed docs (e.g. dynamics.md) link to repo files with parent-
  // traversal paths (../packages/…, ../docs/adr/) that resolve on GitHub but
  // aren't site routes. Tolerate those; every site-internal link is still
  // checked. localhost links are ignored too.
  ignoreDeadLinks: ["localhostLinks", /\.\.\//],

  markdown: {
    // Enable math so `$…$` / `$$…$$` render. Existing derivation docs use
    // fenced-code + Unicode (no LaTeX yet), so this is future-proofing; the AC
    // asked for KaTeX, VitePress ships MathJax3 as its first-class math plugin
    // (same client-side typeset role) — swap-able if we ever need KaTeX exactly.
    math: true,
  },

  themeConfig: {
    nav: [
      { text: "Quick start", link: "/quick-start" },
      {
        text: "Guide",
        items: [
          { text: "6-DOF dynamics", link: "/dynamics" },
          { text: "Controllers", link: "/controllers/" },
          { text: "Write your own controller", link: "/api/controllers" },
          { text: "Benchmarks", link: "/benchmarks" },
        ],
      },
      { text: "ADRs", link: "/adr/" },
      { text: "▶ Play the demo", link: APP_URL },
    ],

    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "Overview", link: "/" },
          { text: "Quick start", link: "/quick-start" },
        ],
      },
      {
        text: "Physics",
        items: [{ text: "6-DOF rigid-body dynamics", link: "/dynamics" }],
      },
      {
        text: "Controllers",
        items: [
          { text: "Overview", link: "/controllers/" },
          { text: "PID", link: "/controllers/pid" },
          { text: "MPC", link: "/controllers/mpc" },
          { text: "RL reward design", link: "/rl-reward" },
        ],
      },
      {
        text: "Contribute",
        items: [
          { text: "Write your own controller", link: "/api/controllers" },
        ],
      },
      {
        text: "Benchmarks",
        items: [{ text: "PID vs MPC vs RL (v1)", link: "/benchmarks" }],
      },
      {
        text: "Reference data",
        items: [
          { text: "Overview", link: "/reference/" },
          { text: "Drag & atmosphere", link: "/reference/dynamics" },
          { text: "Launch-site sourcing", link: "/reference/launch-site-sourcing" },
          { text: "Starbase site", link: "/reference/starbase-site" },
        ],
      },
      {
        text: "Architecture decisions",
        items: [{ text: "ADR index", link: "/adr/" }, ...adrSidebarItems()],
      },
    ],

    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: REPO }],
    editLink: {
      pattern: `${REPO}/edit/main/docs/:path`,
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "MIT-licensed. Physics core shared TS ↔ numpy (parity-tested).",
      copyright: `<a href="${REPO}">Starship Catch Simulator</a> — an open-source engineering demo.`,
    },
  },
});
