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

We track Architecture Decision Records in `docs/adr/`.

1. Copy the template: `cp docs/adr/000-template.md docs/adr/NNN-title.md`
2. Fill in the status, context, decision, and consequences sections.
3. Number sequentially (check the highest existing number).
4. Submit the ADR as part of your feature PR or as a standalone PR.

ADR format:

```markdown
# NNN - Title

**Status:** Proposed | Accepted | Deprecated | Superseded by NNN

## Context

Why is this decision needed?

## Decision

What did we decide?

## Consequences

What are the trade-offs?
```
