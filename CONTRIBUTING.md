# Contributing

Thanks for your interest in the Starship Catch Simulator! This guide covers the basics for getting a pull request merged.

## Branching

- `main` is the stable trunk. All work targets `main` via pull request.
- Create one feature branch per ticket from `main`, named `sls-XX-short-slug`.
  - Example: `sls-12-add-gravity-model`
- Keep branches short-lived. Rebase on `main` before requesting review.

## Commit style

We use **Jira smart commits** so commits auto-link and transition their ticket.
Reference the ticket key + a workflow tag in every message:

```
SLS-XX #in-progress <what this commit does>
```

Use `#in-progress` on work-in-progress commits and `#done` on the final commit
of the ticket (`#comment <text>` appends a Jira comment). Keep the summary line
imperative and concise.

Examples:

```
SLS-11 #in-progress add RK4 integrator
SLS-17 #in-progress correct camera FOV on resize
SLS-63 #done README overhaul. #comment surfaced the M6 neural-policy result
```

## Running the tests

Unit and property tests run in Vitest from the repo root:

```bash
pnpm test            # one-shot
pnpm test:watch      # watch mode
```

End-to-end tests use Playwright against a built bundle. A fresh clone needs to download the Chromium browser binary once:

```bash
pnpm playwright:install   # one-time, ~92 MB
pnpm test:e2e
```

Controller benchmarks (Monte-Carlo catch rate across scenarios) run from
`tools/`:

```bash
pnpm bench:rl     # neural policy + PID on the TS core (30 seeds)
pnpm bench:mpc    # MPC vs PID (needs the local MPC service — see README)
```

## Pull request checklist

Before requesting review, make sure:

- [ ] Branch is rebased on latest `main`
- [ ] `pnpm build` passes at root
- [ ] `pnpm test` passes at root
- [ ] `pnpm lint` passes at root
- [ ] `pnpm typecheck` passes at root
- [ ] New code has tests where applicable
- [ ] Commits use smart-commit syntax referencing the ticket (`SLS-XX #…`)
- [ ] PR description links the relevant Jira ticket

## How to add an ADR

Architecture Decision Records live in [`docs/adr/`](./docs/adr/). The process, format (MADR-lite), and rules are documented in [`docs/adr/README.md`](./docs/adr/README.md) — read that first.

In short:

```bash
cp docs/adr/template.md docs/adr/NNN-your-decision.md
```

Then fill it in, submit as part of your feature PR or as a standalone PR, and link from the relevant Jira ticket.
