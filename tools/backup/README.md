# Backup & continuity (SLS-68)

The code lives in GitHub and survives a dead disk. The project's **institutional
memory** does not, unless it's exported: the Claude agent-memory files, the
local Claude config, and — biggest — the **SLS-43 decisions log** and the
**Confluence KB**, which live on a free-tier Atlassian cloud site with no
built-in export. This directory makes that memory recoverable.

## What's here

| File | What it does |
| --- | --- |
| `export-atlassian.mjs` | Dumps every SLS Jira issue (with full comments) + every Confluence SLS-space page (with body) to timestamped JSON. Dependency-free (Node 20). |
| `backup.sh` | One command: bundles the code repo, syncs the agent-memory dir + local Claude config, runs the Atlassian export, and commits it all to a local git **continuity repo** you can push off-site. |

**Secrets are never written out.** The Atlassian token in
`~/.config/sls-atlassian.env` is read at runtime only; the continuity repo's
`.gitignore` also blocks `*.env` / `*token*` / `*.key` as a backstop.

## Run a backup (do this now, and quarterly)

```bash
bash tools/backup/backup.sh
# → assembles + commits a snapshot in ~/sls-backups/continuity/
#   (override the location with DEST=/Volumes/mydrive/... )
```

Just the Atlassian export on its own: `node tools/backup/export-atlassian.mjs`.

## ⚠️ Confluence export needs OAuth — Basic auth no longer works (2026-09-12)

**Diagnosis (verified, not a guess).** The API token in
`~/.config/sls-atlassian.env` still authenticates **Jira** over Basic auth
(`/rest/api/3/myself` → 200), but **every Confluence endpoint returns 401** —
`/wiki/rest/api/*` (v1), `/wiki/api/v2/*`, even `/wiki/rest/api/user/current`.
The response header is the tell:

```
HTTP/2 401
www-authenticate: OAuth realm="https%3A%2F%2Fyanismuzenitov.atlassian.net"
```

Confluence Cloud is demanding **OAuth** on this site and refusing Basic auth.
**Minting a new API token does not fix this** — confirmed empirically on
2026-09-12 with a freshly-issued token, which authenticated Jira and still 401'd
on every Confluence route. Do not burn time on tokens.

**Impact is contained:** the export is fail-soft — Jira still backs up and
commits, the error is recorded in `atlassian/manifest.json`
(`confluencePages: null` + `confluenceError`), and the **last good
`confluence-kb.json` is left untouched**. The 14 KB pages captured on
2026-08-19 are intact in the continuity repo *and* pushed off-site.

**Ways to refresh the KB backup (pick one):**

1. **Via the OAuth MCP connector (easiest).** Re-authorize the Atlassian
   connector in Claude Code (`/mcp`), then have the agent read the SLS space
   and write `atlassian/confluence-kb.json`. This is OAuth, so it is unaffected
   by the Basic-auth block.
2. **Confluence UI space export.** Space settings → *Export space* → XML/HTML;
   drop the archive into the continuity repo. Fully owner-driven, no API.
3. **Proper OAuth 2.0 (3LO) for the script.** Register an Atlassian app, add
   Confluence read scopes, and extend `export-atlassian.mjs` with a 3LO flow.
   Most work; only worth it if this needs to run unattended (e.g. from cron).

Until one of those lands, **Jira backups stay current and the KB stays pinned
at 2026-08-19** — which is safe, just not fresh.

## Off-site push — owner, one-time

The continuity repo is version-controlled locally but not yet off-site. Push it
to a **private** GitHub repo (it contains the decisions log + memory — do not
make it public):

```bash
gh repo create sls-continuity --private            # or create it in the UI
git -C ~/sls-backups/continuity remote add origin git@github.com:<you>/sls-continuity.git
git -C ~/sls-backups/continuity push -u origin HEAD
```

After that, quarterly is: `bash tools/backup/backup.sh && git -C ~/sls-backups/continuity push`.

## Machine backup — owner, one-time (still open)

`tmutil destinationinfo` currently returns **"No destinations configured"** —
this Mac has no machine-level backup. Attach an external disk or NAS and enable
**Time Machine** (or `restic`) so the whole environment — not just the curated
snapshot above — is recoverable. This is the one AC that can't be scripted from
inside the repo.

## Cadence

Add to the PM cadence (SLS-43): **re-run `backup.sh` + push quarterly**, and
after any milestone that adds significant decisions-log or KB content. Noted in
`CLAUDE.md` working notes.

## Restore runbook ("laptop gone")

Validated end-to-end (SLS-68) — from a fresh machine with only the continuity
repo:

```bash
git clone git@github.com:<you>/sls-continuity.git && cd sls-continuity
git clone repo.bundle sls            # 1. code — full history, all refs
cp -R agent-memory ~/.claude/projects/-Users-dionismuzenitov-projects-SLS/memory   # 2. Claude memory
#  3. decisions log:  atlassian/jira/SLS-43.json  (+ every other SLS-*.json, with comments)
#  4. knowledge base: atlassian/confluence-kb.json  (14 pages, storage-format bodies)
```

The Atlassian JSON is a **read/rehydrate** backup, not a restore-to-cloud tool —
if the Atlassian site itself is lost, the pages/issues are re-created by hand
from the JSON (or imported via the API). The irreplaceable part is the
*content*, and that's captured.
