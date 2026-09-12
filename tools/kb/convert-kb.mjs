#!/usr/bin/env node
/**
 * SLS-118 — convert the Confluence KB export to markdown under `docs/kb/`.
 *
 * Confluence was lost when the free trial ended (SLS-68), so the 14-page
 * knowledge base survives only as the 2026-08-19 JSON export. This script moves
 * that content into git, where it can never again depend on a hosted wiki.
 *
 *   node tools/kb/convert-kb.mjs [--in <confluence-kb.json>] [--out docs/kb]
 *
 * It is deterministic and re-runnable: same input JSON -> byte-identical output,
 * so it can be re-run if the export is ever refreshed. Handles the storage
 * format actually present in this export (verified by tag census, not guessed):
 * standard HTML blocks/inlines plus `info`/`note`/`code` macros, internal
 * `ac:link`+`ri:page` references, ADF decision-lists and task-lists.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const IN = argOf("--in", join(homedir(), "sls-backups/continuity/atlassian/confluence-kb.json"));
const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const OUT = resolve(repoRoot, argOf("--out", "docs/kb"));

/** Stable, readable filename from a page title. */
export function slugify(title) {
  // Titles arrive HTML-escaped ("thrusters &amp; actuators"), so decode first —
  // otherwise the entity name leaks into the filename as "-amp-".
  const TRANSLIT = { ç: "c", ı: "i", ş: "s", ğ: "g", ö: "o", ü: "u", İ: "i", Ş: "s", Ç: "c" };
  return decodeEntities(title)
    .replace(/[çışğöüİŞÇ]/g, (c) => TRANSLIT[c] ?? c)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")        // é -> e, ā -> a …
    .replace(/[’'`]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");                    // no trailing dash after truncation
}

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", times: "×", deg: "°", plusmn: "±",
  micro: "µ", frac12: "½", middot: "·", bull: "•", rarr: "→", larr: "←",
};
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, n) => (n in ENTITIES ? ENTITIES[n] : m));
}

/** Inline-level conversion (no block structure). */
function inline(html, linkResolver) {
  let s = html;
  // Internal Confluence page links -> relative markdown links.
  s = s.replace(
    /<ac:link[^>]*>\s*<ri:page[^>]*ri:content-title="([^"]+)"[^>]*\/>\s*(?:<ac:link-body>([\s\S]*?)<\/ac:link-body>|<ac:plain-text-link-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-link-body>)?\s*<\/ac:link>/g,
    (_, title, body, cdata) => {
      const text = (body || cdata || title).replace(/<[^>]+>/g, "").trim();
      return linkResolver(title, decodeEntities(text));
    },
  );
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, t) => {
    const text = t.replace(/<[^>]+>/g, "").trim();
    return text ? `[${decodeEntities(text)}](${href})` : href;
  });
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/g, (_, t) => `\`${decodeEntities(t.replace(/<[^>]+>/g, ""))}\``);
  // Line breaks FIRST: `<br />` must not be mistaken for an opening bold tag.
  s = s.replace(/<br\s*\/?>/g, "  \n");
  // The `(?:\s[^>]*)?` guard is load-bearing: a bare `[^>]*` lets `<b` swallow
  // `<br />` and `<i` swallow `<img …>`, silently eating the element.
  s = s.replace(/<(?:strong|b)(?:\s[^>]*)?>([\s\S]*?)<\/(?:strong|b)>/g, (_, t) => `**${t.trim()}**`);
  s = s.replace(/<(?:em|i)(?:\s[^>]*)?>([\s\S]*?)<\/(?:em|i)>/g, (_, t) => `_${t.trim()}_`);
  s = s.replace(/<\/?span[^>]*>/g, "");
  s = s.replace(/<[^>]+>/g, "");           // drop any remaining markup
  return decodeEntities(s).replace(/[ \t]+/g, " ").trim();
}

/** Convert one Confluence table to a markdown table. */
function convertTable(tableHtml, linkResolver) {
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) =>
    [...m[1].matchAll(/<(th|td)[^>]*>([\s\S]*?)<\/\1>/g)].map((c) =>
      inline(c[2], linkResolver).replace(/\|/g, "\\|") || " ",
    ),
  );
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(width - r.length).fill(" ")];
  const isHeader = /<th[^>]*>/.test(tableHtml.split("</tr>")[0] ?? "");
  const head = isHeader ? pad(rows[0]) : Array(width).fill(" ");
  const body = isHeader ? rows.slice(1) : rows;
  return [
    `| ${head.join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...body.map((r) => `| ${pad(r).join(" | ")} |`),
  ].join("\n");
}

/** Convert a list (possibly nested) to markdown. */
function convertList(html, ordered, depth, linkResolver) {
  const out = [];
  let i = 0;
  const items = [];
  // Split top-level <li> ... </li> accounting for nesting.
  const re = /<li[^>]*>/g;
  // Only `re.lastIndex` is needed — the match object itself is unused.
  while (re.exec(html) !== null) {
    let d = 1, k = re.lastIndex;
    while (d > 0 && k < html.length) {
      const nextOpen = html.indexOf("<li", k);
      const nextClose = html.indexOf("</li>", k);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) { d++; k = nextOpen + 3; }
      else { d--; k = nextClose + 5; }
    }
    items.push(html.slice(re.lastIndex, k - 5));
    re.lastIndex = k;
  }
  for (const raw of items) {
    const nested = [];
    let body = raw.replace(/<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/g, (_, tag, inner) => {
      nested.push(convertList(inner, tag === "ol", depth + 1, linkResolver));
      return "";
    });
    const bullet = ordered ? `${++i}.` : "-";
    const text = inline(body, linkResolver);
    if (text) out.push(`${"  ".repeat(depth)}${bullet} ${text}`);
    out.push(...nested);
  }
  return out.join("\n");
}

/** Full storage-format -> markdown. */
export function toMarkdown(html, linkResolver) {
  let s = html;
  const stash = [];
  const park = (text) => `\uE000${stash.push(text) - 1}\uE000`;

  // 1. Code macros (CDATA) — park verbatim before any other rewriting.
  s = s.replace(
    /<ac:structured-macro[^>]*ac:name="code"[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/g,
    (_, code) => park("```\n" + code.replace(/\s+$/, "") + "\n```"),
  );
  // 2. info / note panels -> labelled blockquotes.
  s = s.replace(
    /<ac:structured-macro[^>]*ac:name="(info|note|tip|warning)"[\s\S]*?<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>\s*<\/ac:structured-macro>/g,
    (_, kind, body) => {
      const label = { info: "ℹ️ Info", note: "📝 Note", tip: "💡 Tip", warning: "⚠️ Warning" }[kind];
      const inner = toMarkdown(body, linkResolver).trim().split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n");
      return park(`> **${label}**\n>\n${inner}`);
    },
  );
  // 3. ADF decision lists + task lists -> checkbox/decision bullets.
  s = s.replace(/<ac:adf-node type="decision-item">([\s\S]*?)<\/ac:adf-node>/g,
    (_, b) => park(`- ✅ ${inline(b.replace(/<ac:adf-attribute[\s\S]*?<\/ac:adf-attribute>/g, ""), linkResolver)}`));
  s = s.replace(/<ac:adf-extension>[\s\S]*?<\/ac:adf-extension>/g, (m) =>
    [...m.matchAll(/\uE000(\d+)\uE000/g)].map((x) => x[0]).join("\n"));
  s = s.replace(/<ac:task>[\s\S]*?<ac:task-status>(\w+)<\/ac:task-status>[\s\S]*?<ac:task-body>([\s\S]*?)<\/ac:task-body>[\s\S]*?<\/ac:task>/g,
    (_, st, b) => park(`- [${st === "complete" ? "x" : " "}] ${inline(b, linkResolver)}`));
  s = s.replace(/<\/?ac:task-list>/g, "");
  // 4. Tables.
  s = s.replace(/<table[\s\S]*?<\/table>/g, (t) => park(convertTable(t, linkResolver)));
  // 5. Blockquotes.
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/g, (_, b) =>
    park(toMarkdown(b, linkResolver).trim().split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n")));
  // 6. Lists.
  s = s.replace(/<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/g, (_, tag, inner) =>
    park(convertList(inner, tag === "ol", 0, linkResolver)));
  // 7. Headings + paragraphs.
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g, (_, lvl, t) => {
    const text = inline(t, linkResolver);
    // Confluence h1 is a section head inside the page; the page title is the
    // document's h1, so demote everything one level to keep one h1 per file.
    return text ? `\n\n${"#".repeat(Math.min(6, Number(lvl) + 1))} ${text}\n\n` : "";
  });
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/g, (_, t) => {
    const text = inline(t, linkResolver);
    return text ? `\n\n${text}\n\n` : "\n\n";
  });
  s = s.replace(/<hr\s*\/?>/g, "\n\n---\n\n");
  s = s.replace(/<\/?div[^>]*>/g, "\n\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  // Restore parked blocks.
  s = s.replace(/\uE000(\d+)\uE000/g, (_, i) => `\n\n${stash[Number(i)]}\n\n`);
  return s
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function main() {
  const pages = JSON.parse(readFileSync(IN, "utf8"));
  const byTitle = new Map(pages.map((p) => [p.title, slugify(p.title)]));
  const linkResolver = (title, text) => {
    const slug = byTitle.get(title);
    return slug ? `[${text}](${slug}.md)` : `**${text}**`;
  };

  mkdirSync(OUT, { recursive: true });
  const exportedAt = "2026-08-19";
  const index = [];

  // Per-page cross-links where the KB overlaps something already canonical in
  // the repo (SLS-118 AC: de-dupe and note supersessions rather than leaving two
  // copies a reader could mistake for independent sources). Kept here so the
  // banners survive a re-run of the converter.
  const PAGE_NOTES = {
    "adr-005-3d-asset-sourcing-pipeline":
      "**This page is a narrative mirror, not the decision of record.** The canonical ADR is " +
      "[`docs/adr/005-community-assets-licence-policy.md`](../adr/005-community-assets-licence-policy.md); " +
      "if the two disagree, the ADR wins.",
    "starbase-catch-site-pad-a-b-dimensions-and-catch-history":
      "**Catch-history overlap:** the flight-by-flight record here is also maintained, with sources and dates, in " +
      "[`docs/catch-provenance.md`](../catch-provenance.md) (SLS-99) — prefer that page for what is flight-proven " +
      "vs. speculative. This page's value is the *site geometry*.",
    "how-starship-catches-itself-overview":
      "**Overlap:** the V1/V2-vs-V3 catch-interface and flight-record sections are maintained in " +
      "[`docs/catch-provenance.md`](../catch-provenance.md) (SLS-99). This page is the plain-language mental model.",
    "working-with-claude-on-this-knowledge-base":
      "**Historical.** These conventions describe adding pages to the Confluence space, which no longer exists. " +
      "New reference knowledge now goes into `docs/` in the repo — see `CLAUDE.md`.",
    "starship-reference-knowledge-base":
      "**Historical index.** The live index is [`docs/kb/README.md`](README.md); the Confluence page tree this " +
      "describes is gone.",
    "starship-landing-simulator-home":
      "**Historical.** This was the Confluence space home page. The repo's front door is the top-level `README.md`.",
  };

  for (const page of pages) {
    const slug = byTitle.get(page.title);
    const md = toMarkdown(page.body.storage.value, linkResolver);
    const body = [
      `# ${decodeEntities(page.title)}`,
      "",
      `> Migrated from the Confluence SLS space (SLS-118). Confluence was lost when`,
      `> the free trial ended (SLS-68); this file is now the canonical copy.`,
      `> Source: \`confluence-kb.json\` export of ${exportedAt}${page.version?.number ? `, page version ${page.version.number}` : ""}.`,
      ...(PAGE_NOTES[slug] ? ["", `> ${PAGE_NOTES[slug]}`] : []),
      "",
      md,
      "",
    ].join("\n");
    writeFileSync(join(OUT, `${slug}.md`), body);
    index.push({ title: decodeEntities(page.title), slug, bytes: body.length });
    console.log(`  ${slug}.md`.padEnd(56) + `${(body.length / 1024).toFixed(1)} KB`);
  }
  // Index. Grouped by theme rather than Confluence's page tree — the tree was
  // shallow and the groupings below are what a reader actually wants.
  const GROUPS = [
    ["Start here", ["starship-landing-simulator-home", "starship-reference-knowledge-base", "working-with-claude-on-this-knowledge-base"]],
    ["The vehicle & the real manoeuvre", ["how-starship-catches-itself-overview", "raptor-engine-how-it-works-full-flow-staged-combustion", "attitude-control-thrusters-actuators", "reentry-thermal-protection-heat-shield", "booster-descent-aerodynamics-retrograde-blunt-body-drag-cd-m", "starbase-catch-site-pad-a-b-dimensions-and-catch-history"]],
    ["Guidance & control", ["convex-powered-descent-guidance-the-acikmese-blackmore-linea", "learning-based-booster-control-what-worked", "reward-design-for-the-catch-env"]],
    ["Process & decisions", ["implementing-a-ticket-with-claude-code-research-first-sessio", "adr-005-3d-asset-sourcing-pipeline"]],
  ];
  const bySlug = new Map(index.map((e) => [e.slug, e]));
  const seen = new Set();
  const lines = [
    "# Knowledge base",
    "",
    "Narrative reference for how the real Starship, Raptor engine, catch sequence,",
    "reentry and attitude control work — the grounding behind the simulator's",
    "modelling choices.",
    "",
    "> **⚠️ Provenance**",
    ">",
    "> These pages lived in a Confluence space until the free trial ended and the",
    "> product was removed from the Atlassian site (SLS-68). They were recovered from",
    `> the \`confluence-kb.json\` backup of ${exportedAt} and converted to markdown by`,
    "> `tools/kb/convert-kb.mjs` (SLS-118). **This directory is now the canonical copy.**",
    "> Re-run the converter only if the export itself is ever refreshed.",
    "",
    "Related in-repo references: [physical reference data](../reference/README.md) ·",
    "[catch provenance](../catch-provenance.md) · [architecture decisions](../adr/README.md).",
    "",
    "## Editing these notes (Obsidian)",
    "",
    "This directory doubles as an **Obsidian vault** (SLS-120) — an Obsidian vault is",
    "just a folder of markdown files, so no conversion or import is needed:",
    "",
    "1. Obsidian → **Open folder as vault** → select `docs/kb`.",
    "2. Edit normally. Changes are plain files; commit them like any other change.",
    "",
    "Syncing is git — Obsidian Sync/Publish (both paid) are deliberately not used.",
    "",
    "> **⚠️ Keep links markdown-style**",
    ">",
    "> VitePress cannot resolve Obsidian's `[[wikilinks]]`, so writing them would",
    "> break the docs build. `.obsidian/app.json` is committed precisely to pin",
    "> `useMarkdownLinks: true` + relative paths — don't change those settings.",
    "> Everything else under `.obsidian/` is gitignored as per-user state.",
    "",
  ];
  for (const [heading, slugs] of GROUPS) {
    lines.push(`## ${heading}`, "");
    for (const slug of slugs) {
      const e = bySlug.get(slug);
      if (!e) continue;
      seen.add(slug);
      lines.push(`- [${e.title}](${slug}.md)`);
    }
    lines.push("");
  }
  const rest = index.filter((e) => !seen.has(e.slug));
  if (rest.length) {
    lines.push("## Other", "", ...rest.map((e) => `- [${e.title}](${e.slug}.md)`), "");
  }
  writeFileSync(join(OUT, "README.md"), lines.join("\n"));
  console.log(`  README.md (index, ${index.length} pages)`);

  console.log(`\n${index.length} pages -> ${OUT}`);
  return index;
}

if (process.argv[1] && process.argv[1].endsWith("convert-kb.mjs")) main();
