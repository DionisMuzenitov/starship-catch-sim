# ADR-001: Tech stack

- **Status:** Accepted
- **Date:** 2026-05-23
- **Tickets:** SLS-5

## Context

We are building a real-time browser simulation that has to host several controller strategies including a convex MPC and a deep-RL policy. We need a coherent language and tooling story across four surfaces — web app, physics core, MPC solver, RL training/inference — because data flows between them.

## Decision

- **Web app and visualisation:** TypeScript + Vite + React Three Fiber (R3F).
- **Physics core (`packages/physics`):** pure TypeScript, no framework dependencies — see ADR-004.
- **MPC service:** Python (FastAPI + CVXPY/Clarabel), called over HTTP from the browser.
- **RL training:** Python + PyTorch, exported to ONNX for in-browser inference.

## Consequences

- **Positive:** Single TypeScript stack for the per-frame hot path (sim + visualisation + most controllers); no language boundary on the inner loop.
- **Positive:** Python lets us reuse decades of convex-optimisation work (CVXPY, Clarabel) for the MPC solver instead of inventing it in TS.
- **Positive:** PyTorch + Gymnasium + Stable-Baselines3 is the dominant RL ecosystem; ONNX gives us a clean browser-inference handoff.
- **Negative:** Two languages on the project; few contributors will fluently know both.
- **Negative:** MPC over HTTP adds a network hop per solve, so it operates at "advisory" rates (~10 Hz) rather than the 60+ Hz sim loop. Acceptable for the demo; a future ADR will revisit this if we WASM-port the solver.

## Alternatives considered

- **All-TypeScript stack with a hand-rolled SOCP/QP solver.** Rejected — Clarabel/ECOS represent decades of mathematical work we don't want to re-implement; correctness risk is too high for a project where the controller comparison is the point.
- **All-Python stack via Pyodide in the browser.** Rejected — Pyodide's startup time, bundle size, and Three.js interop are all worse than the current split.
- **Babylon.js instead of R3F.** Rejected — R3F lets us keep React's component model for HUD/UI without adding a second paradigm.
- **TensorFlow.js for RL.** Rejected — far weaker RL tooling than PyTorch; ONNX is our portability bet.
