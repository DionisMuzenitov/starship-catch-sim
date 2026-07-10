#!/usr/bin/env bash
#
# Big-blob guard (SLS-65). Fails if any *tracked* file exceeds the size limit,
# to stop large binaries — chiefly RL training datasets (services/rl/demos*/,
# ~45 MB per .npz) — from being committed and bloating every clone of the
# public repo. Datasets belong in .gitignore (kept local) or attached to a
# GitHub Release, never in git history.
#
# Portable (bash + coreutils only): runs in CI and locally / in a pre-push hook.
set -euo pipefail

LIMIT_MB=5
LIMIT=$((LIMIT_MB * 1024 * 1024))

# Extended-regex of repo-relative paths permitted to exceed the limit. Keep it
# tight and justified — nothing tracked currently exceeds 5 MB (the largest are
# apps/web/public/assets/starship-stack.glb ~2.2 MB and booster_policy.json
# ~1.5 MB), so the allowlist starts empty. Add a real large asset here (with a
# comment saying why) rather than raising the global limit.
ALLOWLIST='^$'

violations=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  size=$(wc -c <"$f" | tr -d '[:space:]')
  if [ "$size" -gt "$LIMIT" ]; then
    if printf '%s' "$f" | grep -Eq "$ALLOWLIST"; then
      continue
    fi
    printf 'ERROR: %s is %s bytes (> %d MB limit)\n' "$f" "$size" "$LIMIT_MB" >&2
    violations=$((violations + 1))
  fi
done < <(git ls-files)

if [ "$violations" -gt 0 ]; then
  cat >&2 <<EOF

${violations} tracked file(s) exceed the ${LIMIT_MB} MB limit.
Large training data / binaries must not live in git — they bloat every clone.
  • Datasets (services/rl/demos*/, runs/, checkpoints*/) are gitignored: keep
    them local, or attach them to a GitHub Release.
  • If a file is a legitimate large asset, add its path to ALLOWLIST in
    tools/ci/check-blob-sizes.sh, with a comment justifying it.
EOF
  exit 1
fi

echo "blob-size guard: OK (no tracked file over ${LIMIT_MB} MB)"
