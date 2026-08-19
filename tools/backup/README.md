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
