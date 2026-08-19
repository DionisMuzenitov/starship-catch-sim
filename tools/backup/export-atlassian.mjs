#!/usr/bin/env node
/**
 * SLS-68 — repeatable Atlassian backup. Dumps every SLS Jira issue (with full
 * comments) and every Confluence SLS-space page (with body) to timestamped
 * JSON, so the project's institutional memory — the SLS-43 decisions log and
 * the KB — survives a dead laptop or a free-tier Atlassian site going away.
 *
 * The code survives a dead disk (it's in git); this data does not, unless it's
 * exported. Run it now, and quarterly (see tools/backup/README.md).
 *
 * Usage:
 *   node tools/backup/export-atlassian.mjs [--out <dir>]
 * Reads creds from ~/.config/sls-atlassian.env (JIRA_URL / JIRA_USERNAME /
 * JIRA_API_TOKEN — the same token authenticates Confluence). No secrets are
 * written to the output. Default out dir: ~/sls-backups/atlassian-<UTC-stamp>/.
 *
 * Dependency-free (Node 20 global fetch). Not wired into CI — it needs creds CI
 * doesn't have; it's an operator/cron tool.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SPACE = "SLS";
const PROJECT = "SLS";

function loadEnv() {
  // Prefer an already-exported environment; else parse the creds file.
  const env = { ...process.env };
  const path = join(homedir(), ".config/sls-atlassian.env");
  if (existsSync(path)) {
    for (const raw of readFileSync(path, "utf8").split("\n")) {
      const line = raw.replace(/^\s*export\s+/, "").trim();
      const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  const url = (env.JIRA_URL || "").replace(/\/+$/, "");
  const user = env.JIRA_USERNAME;
  const token = env.JIRA_API_TOKEN;
  if (!url || !user || !token) {
    console.error(
      "Missing creds. Need JIRA_URL / JIRA_USERNAME / JIRA_API_TOKEN in " +
        "~/.config/sls-atlassian.env (or the environment).",
    );
    process.exit(1);
  }
  return { url, auth: "Basic " + Buffer.from(`${user}:${token}`).toString("base64") };
}

async function api(url, auth, path) {
  const resp = await fetch(url + path, {
    headers: { authorization: auth, accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} on ${path} — ${await resp.text()}`);
  }
  return resp.json();
}

/** All SLS issue keys, via the paginated /search/jql endpoint. */
async function jiraKeys(url, auth) {
  const keys = [];
  let token = null;
  do {
    const q = new URLSearchParams({
      jql: `project = ${PROJECT} ORDER BY created ASC`,
      maxResults: "100",
      fields: "key",
    });
    if (token) q.set("nextPageToken", token);
    const page = await api(url, auth, `/rest/api/3/search/jql?${q}`);
    for (const i of page.issues ?? []) keys.push(i.key);
    token = page.nextPageToken ?? null;
  } while (token);
  return keys;
}

/** Full issue incl. all comments (pages the comment field if it's capped). */
async function jiraIssue(url, auth, key) {
  const issue = await api(
    url,
    auth,
    `/rest/api/3/issue/${key}?fields=*all&expand=renderedFields,names`,
  );
  const c = issue.fields?.comment;
  if (c && c.total > (c.comments?.length ?? 0)) {
    const all = [];
    let startAt = 0;
    do {
      const page = await api(
        url,
        auth,
        `/rest/api/3/issue/${key}/comment?startAt=${startAt}&maxResults=100`,
      );
      all.push(...(page.comments ?? []));
      startAt += page.maxResults ?? 100;
      if (startAt >= (page.total ?? all.length)) break;
    } while (true);
    issue.fields.comment.comments = all;
  }
  return issue;
}

/** All Confluence pages in the space, with storage-format body. */
async function confluencePages(url, auth) {
  const pages = [];
  let path = `/wiki/rest/api/content?spaceKey=${SPACE}&type=page&status=current&expand=body.storage,version,ancestors&limit=50`;
  while (path) {
    const page = await api(url, auth, path);
    pages.push(...(page.results ?? []));
    path = page._links?.next ?? null; // relative next link, already /wiki/...
  }
  return pages;
}

async function main() {
  const { url, auth } = loadEnv();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const argOut = process.argv.indexOf("--out");
  const outDir =
    argOut >= 0 && process.argv[argOut + 1]
      ? process.argv[argOut + 1]
      : join(homedir(), "sls-backups", `atlassian-${stamp}`);
  mkdirSync(join(outDir, "jira"), { recursive: true });

  console.log(`Exporting ${PROJECT} from ${url}\n  → ${outDir}`);

  const keys = await jiraKeys(url, auth);
  console.log(`Jira: ${keys.length} issues`);
  const issues = [];
  let commentTotal = 0;
  for (const key of keys) {
    const issue = await jiraIssue(url, auth, key);
    issues.push(issue);
    commentTotal += issue.fields?.comment?.comments?.length ?? 0;
    writeFileSync(join(outDir, "jira", `${key}.json`), JSON.stringify(issue, null, 2));
  }
  writeFileSync(join(outDir, "jira-all.json"), JSON.stringify(issues, null, 2));
  console.log(`  ${keys.length} issues, ${commentTotal} comments`);

  const pages = await confluencePages(url, auth);
  writeFileSync(join(outDir, "confluence-kb.json"), JSON.stringify(pages, null, 2));
  console.log(`Confluence: ${pages.length} pages`);

  const manifest = {
    exportedAt: new Date().toISOString(),
    site: url,
    project: PROJECT,
    space: SPACE,
    jiraIssues: keys.length,
    jiraComments: commentTotal,
    confluencePages: pages.length,
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nDone. Manifest:\n${JSON.stringify(manifest, null, 2)}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
