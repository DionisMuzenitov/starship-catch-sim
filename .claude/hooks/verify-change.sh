#!/usr/bin/env bash
# PostToolUse hook: auto-verify after every Edit/Write on .ts/.tsx.
#
# Receives tool-call JSON on stdin. Exit 2 => stderr is fed back to Claude,
# which then sees (and fixes) the failure without being asked.
#
# Adapted to this repo:
#   - typecheck = `pnpm typecheck` (root script fans out via `pnpm -r`)
#   - related tests = `pnpm exec vitest related --run <file>`
set -uo pipefail

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only verify TypeScript source files
case "$FILE" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Node 20 is keg-only on this machine — ensure pnpm/node resolve.
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"

ERRORS=""

# 1) Workspace-wide typecheck.
if ! TYPE_OUT=$(pnpm typecheck 2>&1); then
  ERRORS+="TYPECHECK FAILED:\n${TYPE_OUT}\n\n"
fi

# 2) Tests related to the changed file. --run forces single-pass.
if ! TEST_OUT=$(pnpm exec vitest related --run "$FILE" 2>&1); then
  ERRORS+="RELATED TESTS FAILED:\n${TEST_OUT}\n"
fi

if [ -n "$ERRORS" ]; then
  printf '%b' "$ERRORS" | tail -c 8000 >&2
  exit 2   # non-blocking, but Claude sees stderr and self-corrects
fi
exit 0
