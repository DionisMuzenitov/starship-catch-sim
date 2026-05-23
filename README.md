# Starship Catch Simulator

[![CI](https://github.com/DionisMuzenitov/starship-catch-sim/actions/workflows/ci.yml/badge.svg)](https://github.com/DionisMuzenitov/starship-catch-sim/actions/workflows/ci.yml)

> Work is tracked in Jira: [SLS board](https://yanismuzenitov.atlassian.net/jira/software/projects/SLS/boards/67).

## Pitch

A real-time simulation of SpaceX's Starship booster catch manoeuvre. The simulator models 6-DOF rigid-body dynamics, grid-fin and engine-gimbal control, and the tower ("Mechazilla") catch mechanism so you can experiment with guidance algorithms, visualise trajectories in 3-D, and benchmark Model Predictive Control strategies — all in the browser.

## Quick start

```bash
# Prerequisites: Node 20+, pnpm 9+
git clone <repo-url> && cd starship-catch-sim

pnpm install          # install all workspace dependencies
pnpm dev              # start every package in dev/watch mode
```

Open <http://localhost:5173> (default Vite port) to see the web app.

## Repo layout

```
starship-catch-sim/
├── apps/
│   └── web/              # Browser front-end (Three.js / React)
├── packages/
│   ├── physics/          # 6-DOF dynamics, integrators, environment models
│   └── controllers/      # PID, LQR, MPC controller implementations
├── services/
│   └── mpc/              # MPC solver micro-service
├── docs/                 # Documentation & ADRs
├── pnpm-workspace.yaml
└── package.json          # Root workspace scripts
```

## Milestones

| Milestone | Description                        | Status  |
| --------- | ---------------------------------- | ------- |
| M0        | Monorepo scaffold & CI             | Current |
| M1        | 1-DOF vertical landing sim         | Planned |
| M2        | 3-DOF planar sim + basic viz       | Planned |
| M3        | 6-DOF sim + MPC solver             | Planned |
| M4        | Full 3-D visualisation + catch sim | Planned |

<!-- TODO: add demo gif once M2 is complete -->

## License

This project is licensed under the [MIT License](./LICENSE).
