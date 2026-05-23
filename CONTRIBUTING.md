# Contributing

Thanks for your interest in the Starship Catch Simulator! This guide covers the basics for getting a pull request merged.

## Branching

- `main` is the stable trunk. All work targets `main` via pull request.
- Create feature branches from `main` using the pattern: `<type>/<SLS-ticket>-<short-description>`
  - Example: `feat/SLS-12-add-gravity-model`
- Keep branches short-lived. Rebase on `main` before requesting review.

## Commit style

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

Common types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`.

Scope is typically the package name (e.g., `physics`, `web`, `mpc`).

Examples:

```
feat(physics): add RK4 integrator
fix(web): correct camera FOV on resize
docs: update repo layout in README
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

The perf harness is a stub today; real benchmarks land with the integrator in M1:

```bash
pnpm bench
```

## Pull request checklist

Before requesting review, make sure:

- [ ] Branch is rebased on latest `main`
- [ ] `pnpm build` passes at root
- [ ] `pnpm test` passes at root
- [ ] `pnpm lint` passes at root
- [ ] `pnpm typecheck` passes at root
- [ ] New code has tests where applicable
- [ ] PR title follows conventional commit format
- [ ] PR description links the relevant Jira ticket (e.g., `Closes SLS-12`)

## How to add an ADR

Architecture Decision Records live in [`docs/adr/`](./docs/adr/). The process, format (MADR-lite), and rules are documented in [`docs/adr/README.md`](./docs/adr/README.md) — read that first.

In short:

```bash
cp docs/adr/template.md docs/adr/NNN-your-decision.md
```

Then fill it in, submit as part of your feature PR or as a standalone PR, and link from the relevant Jira ticket.
