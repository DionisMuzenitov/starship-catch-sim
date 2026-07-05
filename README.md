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
│   └── controllers/      # Manual, cascaded-PID and MPC controllers + eval harness
├── services/
│   └── mpc/              # Convex-MPC guidance service (FastAPI + CVXPY/Clarabel)
├── tools/                # Benchmarks + Monte-Carlo eval scripts
├── docs/                 # Documentation, ADRs, reference data
├── pnpm-workspace.yaml
└── package.json          # Root workspace scripts
```

To run the web app together with the MPC guidance service:

```bash
pnpm dev:full             # vite dev server + uvicorn on :8100 (needs uv)
```

## Milestones

| Milestone | Description                                                    | Status  |
| --------- | -------------------------------------------------------------- | ------- |
| M1        | Physics core: 6-DOF dynamics, atmosphere, Mach-dependent drag  | Done    |
| M2        | 3-D visualisation: tower, HUD, cameras, replays                | Done    |
| M3        | Sim runner, catch detection, manual flight                      | Done    |
| M4        | Cascaded-PID baseline + tuning panel + Monte-Carlo evaluator    | Done    |
| M5        | Convex MPC guidance (SOCP/SCvx service + client + benchmarks)   | Done¹   |
| M6        | RL: gym env, numpy physics port, PPO training, browser inference| Planned |
| M7        | Hosted demo, leaderboard, docs site, write-up                   | Planned |

¹ MPC infrastructure is shipped and verified; the catch-capability exit
gate (coast-phase ignition planning) is tracked in SLS-47.

<!-- TODO: add demo gif once assets (SLS-44) land -->

## License

This project is licensed under the [MIT License](./LICENSE).
