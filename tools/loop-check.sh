#!/usr/bin/env bash
# Loop-closure guard (SLS-107) — the Jira half of the docs-freshness check.
#
# CI has no Jira credentials, so this runs LOCALLY (build/PM seat):
#   pnpm loop:check
# It fetches the newest comment on SLS-43 ([PM] Command Center) and warns when
# that comment predates today — i.e. a session touched board/repo state but the
# run-report was never posted (the project's worst recorded process failure).
#
# Credentials: ~/.config/sls-atlassian.env (export JIRA_URL / JIRA_USERNAME /
# JIRA_API_TOKEN — the same file the community MCP server uses).
#
# Exit codes: 0 = fresh (or credentials missing — warns, never blocks CI-style
# usage); 1 = stale with --strict.

set -euo pipefail

ENV_FILE="${SLS_ATLASSIAN_ENV:-$HOME/.config/sls-atlassian.env}"
STRICT=0
if [ "${1:-}" = "--strict" ]; then STRICT=1; fi

if [ ! -f "$ENV_FILE" ]; then
  echo "loop:check SKIPPED — no credentials file at $ENV_FILE (this check is local-only)"
  exit 0
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

if [ -z "${JIRA_URL:-}" ] || [ -z "${JIRA_USERNAME:-}" ] || [ -z "${JIRA_API_TOKEN:-}" ]; then
  echo "loop:check SKIPPED — JIRA_URL / JIRA_USERNAME / JIRA_API_TOKEN not set in $ENV_FILE"
  exit 0
fi

# Network/API failures must WARN, never abort (set -e) — only --strict
# staleness may exit non-zero.
if ! LATEST_JSON=$(curl -sS --max-time 20 -u "$JIRA_USERNAME:$JIRA_API_TOKEN" \
  "$JIRA_URL/rest/api/2/issue/SLS-43/comment?orderBy=-created&maxResults=1" 2>&1); then
  echo "loop:check WARNING — could not reach Jira at $JIRA_URL ($LATEST_JSON)."
  echo "Infrastructure failure, not a staleness verdict."
  exit 0
fi

# Compare in LOCAL time on both sides: Jira returns `created` in the profile
# timezone (e.g. +0000 while the Mac is +0200) — converting via astimezone()
# before taking the date avoids mislabelling a just-closed loop as stale.
# The python never exits non-zero: parse failures print "" (warn branch below).
if ! LATEST_DATE=$(printf '%s' "$LATEST_JSON" | python3 -c '
import json, re, sys
from datetime import datetime
try:
    comments = json.load(sys.stdin).get("comments", [])
    if not comments:
        print("")
    else:
        s = comments[0]["created"]  # e.g. 2026-07-26T00:57:33.365+0300
        s = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", s)
        print(datetime.fromisoformat(s).astimezone().date().isoformat())
except Exception:
    print("")
' 2>/dev/null); then
  LATEST_DATE=""
fi

TODAY=$(date +%Y-%m-%d)

if [ -z "$LATEST_DATE" ]; then
  echo "loop:check WARNING — could not read the newest SLS-43 comment (auth error or API shape change?)"
  echo "Infrastructure failure, not a staleness verdict."
  exit 0
fi

if [ "$LATEST_DATE" = "$TODAY" ]; then
  echo "loop:check OK — newest SLS-43 comment is dated today ($LATEST_DATE); the loop is closed"
  exit 0
fi

echo "loop:check STALE — newest SLS-43 comment is $LATEST_DATE, today is $TODAY."
echo "If this session changed board or repo state, post the run-report comment on SLS-43 before ending it (CLAUDE.md, protocol step 7)."
if [ "$STRICT" = "1" ]; then exit 1; fi
exit 0
