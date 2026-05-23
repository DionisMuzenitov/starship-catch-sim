# ADR-004: Engine-agnostic physics core

- **Status:** Accepted
- **Date:** 2026-05-23
- **Tickets:** SLS-5

## Context

`packages/physics` will hold the 6-DOF integrator, dynamics, atmosphere, and aerodynamic surfaces — the actual simulation. Two pressures pull in opposite directions: the *web app* would like to share math types (`Vec3`, `Quat`) with Three.js for convenience, while the *future roadmap* needs the physics core portable to Rust/WASM (SLS-27), a Python Gymnasium env (SLS-28), and possibly a Bevy port.

## Decision

`packages/physics` must not import from Three.js, React, `@react-three/*`, or any other rendering/UI library. It depends only on the standard library and pure-math utilities. Math primitives (`Vec3`, `Quat`, rigid-body state types) are defined **inside** `packages/physics`, not borrowed from Three.js. Conversion to Three.js types happens at the rendering boundary in `apps/web`.

This is enforced by an ESLint `no-restricted-imports` rule scoped to `packages/physics/**` in `eslint.config.js`, with a comment pointing back to this ADR.

## Consequences

- **Positive:** Porting the physics core later (Rust/WASM, numpy for RL, Bevy) becomes a translation exercise rather than a "rip out the engine" rewrite.
- **Positive:** Property-based tests for the physics live in the same package as the physics, with no headless-browser dependency.
- **Negative:** We duplicate `Vec3`/`Quat` between `packages/physics` and (the Three.js-using) renderer in `apps/web`. A conversion adapter at the rendering boundary is real cost in both code and (negligible) per-frame ops.
- **Negative:** Contributors new to the project will reach for `import { Vector3 } from 'three'` inside physics code and be stopped by lint. The lint message points to this ADR.

## Alternatives considered

- **Use Three.js math types in `packages/physics`.** Rejected — couples physics to a renderer and breaks every future port.
- **No enforcement, "just be careful".** Rejected — conventions that aren't enforced erode within months. ESLint guard costs effectively nothing.
- **Vendor `gl-matrix` (or similar) into `packages/physics`.** Rejected — `gl-matrix` uses out-parameters for performance, a different ergonomic; our needs are modest enough that ~200 lines of hand-rolled, property-tested `Vec3`/`Quat` will be clearer.
