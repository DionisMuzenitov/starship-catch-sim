# Starship Catch Simulator — Claude context

## Project tracker (Jira)

- **Site:** `yanismuzenitov.atlassian.net`
- **Project key:** `SLS`
- **Board:** https://yanismuzenitov.atlassian.net/jira/software/projects/SLS/boards/67

When using the Atlassian MCP tools, pass `cloudId: "yanismuzenitov.atlassian.net"`. All `mcp__claude_ai_Atlassian_Rovo__*` tools are pre-allowed in `.claude/settings.local.json` — do not ask for permission per call.

## GitHub

- **Repo:** https://github.com/DionisMuzenitov/starship-catch-sim (public)
- **Owner:** `DionisMuzenitov` (note: differs in case from local Mac user `dionismuzenitov`)
- `gh` CLI is installed and authenticated for this account with scopes `gist, read:org, repo, workflow`. Git uses `gh` as credential helper (`gh auth setup-git` already run).
- Workflow: from SLS-5 onward, each ticket gets its own feature branch + PR. Direct commits to `main` are only for bootstrap.

## What this repo is

Real-time browser simulation of SpaceX's Starship booster "Mechazilla" catch manoeuvre — 6-DOF rigid-body dynamics, grid-fin + engine-gimbal control, MPC strategies. pnpm workspace: `apps/web` (Three.js/React), `packages/physics`, `packages/controllers`, `services/mpc`. See `README.md` for milestones.

## Working notes

- Node 20 is keg-only on this machine — prepend `/opt/homebrew/opt/node@20/bin` to `PATH` for `pnpm`/`node`.
- When pulling a Jira issue list, request a narrow `fields` set (`["summary", "status", "issuetype", "priority"]`) — the full payload exceeds the tool result limit.
