# ADR-002: 6-DOF state and 3-D rendering from day one

- **Status:** Accepted
- **Date:** 2026-05-23
- **Tickets:** SLS-5

## Context

The temptation is real to ship faster by starting with a 1-D vertical landing simulator and adding dimensions per milestone — the README's M1 milestone literally says "1-DOF vertical landing sim". But each dimensionality jump is a rewrite if the *types* are also 1-D. And the user-facing experience is meant to be a 3-D rocket landing on a 3-D tower; a 2-D top-down or side-view phase would undersell the project on first impression and require throwaway visualisation code.

## Decision

The simulation's state types, math primitives (`Vec3`, `Quat`), integrators, and visualisation are **full 6-DOF and 3-D from the first commit**. Early scenarios (M1) may *constrain* certain degrees of freedom to zero — e.g. lock horizontal velocity and pitch/yaw rotation for the 1-D vertical-landing scenario — but the constraint lives in the *scenario configuration*, not in the types, APIs, integrator, or scene graph.

## Consequences

- **Positive:** No retyping or refactoring when scenarios get richer; the visualisation always looks like a rocket in 3-D space.
- **Positive:** Property-based tests for math primitives (quaternion identity, normalisation, RK4 conservation laws) written at M1 still apply at M6.
- **Positive:** The earliest playable build is recognisably "Starship landing", which is the most motivating feedback loop for the project.
- **Negative:** M1 carries code (full quaternion attitude integration, full inertia-tensor handling) that the trivial 1-D problem doesn't strictly need. We pay this upfront in exchange for not paying it twice.
- **Negative:** Slightly slower path to "first playable" — no `Math.sqrt`-and-call-it-physics shortcut.

## Alternatives considered

- **Planar (2-D) intermediate phase.** Rejected — doubles the dimensionality rewrites (1-D → 2-D → 3-D) and the visualisation looks toy-like, killing the motivational payoff.
- **Full 6-DOF physics but a top-down 2-D visualisation early.** Rejected — the 3-D visualisation is a key motivator and pedagogical surface; dropping it early kills the most rewarding feedback loop.
