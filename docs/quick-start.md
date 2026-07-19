# Quick start

## Play it online

The simulator runs entirely in the browser — no install:

**[▶ Launch the live demo](https://dionismuzenitov.github.io/starship-catch-sim/)**

The booster starts falling toward the tower. To watch it get caught, open the
**controller** dropdown (top-left) and pick **RL** — the trained policy flies the
descent and attempts the catch. Or leave it on **Manual** and fly it yourself.

::: tip
Press **`?`** in the app for the full list of keyboard controls and an
explanation of the controller / override system.
:::

### Controls at a glance

| Key | Action |
| --- | --- |
| `W` / `S` | throttle up / down (selected engine group) |
| `1` / `2` / `3` / `4` | select engine group (centre / inner / outer / ship) |
| arrows, or `Q` / `E` | gimbal pitch / yaw |
| `Space` | pause / resume |
| `[` / `]` | time scale ÷2 / ×2 |
| `R` | reset the scenario |
| `C` / `T` / `G` / `O` / `N` / `M` | camera modes |
| `?` | help overlay |

A **catch** is a touchdown inside the tower's chopstick envelope within the
speed, tilt, and angular-rate limits (see the [RL reward page](/rl-reward) for
the exact thresholds).

## Run it locally

The project is a pnpm monorepo (Vite + React + react-three-fiber, TypeScript
strict). You need **Node 20** and **pnpm 9+**.

```bash
git clone https://github.com/DionisMuzenitov/starship-catch-sim
cd starship-catch-sim
pnpm install
pnpm dev          # starts the web app (and workspace dev servers)
```

Then open the printed local URL (Vite defaults to `http://localhost:5173`).

### Handy scripts

```bash
pnpm test         # unit + property tests (Vitest + fast-check)
pnpm typecheck    # tsc across the workspace
pnpm test:e2e     # Playwright end-to-end (web app)
pnpm eval:all     # controller evaluation harness
```

## Where to go next

- **[6-DOF dynamics](/dynamics)** — the equations of motion the sim integrates.
- **[Controllers](/controllers/)** — how Manual / PID / MPC / RL each fly it.
- **[Write your own controller](/api/controllers)** — drop your own agent into
  the loop in ~30 lines.
- **[Benchmarks](/benchmarks)** — PID vs MPC vs RL on the same scenarios.
