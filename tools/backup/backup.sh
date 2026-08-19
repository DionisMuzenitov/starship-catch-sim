#!/usr/bin/env bash
# SLS-68 — one-command project-continuity backup. Assembles everything that
# would NOT survive a dead laptop into a single local git repo you can push to a
# private off-site remote:
#   - the full code repo as a git bundle (all refs, offline-clonable)
#   - the Claude agent-memory dir (institutional context, not in any repo)
#   - the project's .claude/settings.local.json (local allow-list patterns)
#   - the Atlassian export (SLS Jira issues+comments + Confluence KB) via
#     export-atlassian.mjs
#
# The code itself lives in GitHub; this captures the memory around it. Run now
# and quarterly (see README.md). SECRETS ARE NEVER COPIED — the Atlassian token
# in ~/.config/sls-atlassian.env is read at runtime and never written out.
#
# Usage:  bash tools/backup/backup.sh
#         DEST=/Volumes/mydrive/sls-continuity bash tools/backup/backup.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
mem="$HOME/.claude/projects/-Users-dionismuzenitov-projects-SLS/memory"
dest="${DEST:-$HOME/sls-backups/continuity}"       # the version-controlled continuity repo
stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"

command -v node >/dev/null || { echo "node not found on PATH" >&2; exit 1; }
mkdir -p "$dest"

# One-time: make the destination a git repo with a secret-proof .gitignore.
if [ ! -d "$dest/.git" ]; then
  git -C "$dest" init -q
  cat > "$dest/.gitignore" <<'GI'
# Never commit secrets, even if a future step copies them in by mistake.
*.env
*secret*
*token*
*.key
GI
  echo "Initialized continuity repo at $dest"
fi

echo "== 1/4 code repo -> git bundle =="
git -C "$repo" bundle create "$dest/repo.bundle" --all
git -C "$repo" rev-parse HEAD > "$dest/repo-HEAD.txt"

echo "== 2/4 agent memory =="
rm -rf "$dest/agent-memory"; mkdir -p "$dest/agent-memory"
if [ -d "$mem" ]; then cp -R "$mem/." "$dest/agent-memory/"; else echo "  (memory dir not found: $mem)"; fi

echo "== 3/4 local Claude config (patterns only, no secrets) =="
mkdir -p "$dest/claude-local"
[ -f "$repo/.claude/settings.local.json" ] && cp "$repo/.claude/settings.local.json" "$dest/claude-local/" || echo "  (no settings.local.json)"

echo "== 4/4 Atlassian export (Jira + Confluence) =="
rm -rf "$dest/atlassian"; mkdir -p "$dest/atlassian"
node "$here/export-atlassian.mjs" --out "$dest/atlassian"

cat > "$dest/README.md" <<EOF
# SLS continuity snapshot

Last backup: $stamp (UTC). Regenerate: \`bash tools/backup/backup.sh\` from the code repo.

Contents:
- \`repo.bundle\` — full code repo (all refs). Restore: \`git clone repo.bundle sls\`.
- \`agent-memory/\` — Claude agent memory (\`~/.claude/.../memory/\`).
- \`claude-local/settings.local.json\` — local allow-list patterns.
- \`atlassian/\` — SLS Jira issues+comments + Confluence KB (see \`atlassian/manifest.json\`).

To push off-site (owner, one-time):
    git -C "$dest" remote add origin git@github.com:<you>/sls-continuity.git   # PRIVATE repo
    git -C "$dest" push -u origin HEAD
Then quarterly it's just: \`bash tools/backup/backup.sh && git -C "$dest" push\`.
EOF

git -C "$dest" add -A
if git -C "$dest" diff --cached --quiet; then
  echo "No changes since last snapshot."
else
  git -C "$dest" commit -q -m "continuity backup $stamp"
  echo "Committed snapshot $stamp to $dest"
fi

echo ""
echo "Backup complete: $dest"
echo "Off-site push (owner): add a PRIVATE remote and 'git -C $dest push' (see $dest/README.md)."
