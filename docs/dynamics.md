# 6-DOF Rigid-Body Dynamics

> Derivation of the equations of motion implemented in
> [`packages/physics/src/integrator.ts`](../packages/physics/src/integrator.ts).

## Scope

The simulator models a single rigid body (a Starship booster, the ship itself,
or a debris fragment) with six degrees of freedom: three translational and
three rotational. Forces and torques are accumulated by the caller; this file
covers only the equations the integrator must solve.

Per ADR-002, state and types are full 6-DOF from day one — early scenarios
constrain certain degrees of freedom to zero rather than narrowing the types.

## Notation

| Symbol | Meaning | Frame | Units |
| --- | --- | --- | --- |
| `x` | position of body centre of mass | world | m |
| `v` | linear velocity | world | m/s |
| `q` | attitude quaternion (rotation body → world) | — | unitless |
| `ω` | angular velocity | **body** | rad/s |
| `m` | mass | — | kg |
| `I` | inertia tensor about the centre of mass | **body** | kg·m² |
| `F` | total external force | world | N |
| `τ` | total external torque | **body** | N·m |

Conventions are fixed in
[ADR-001 / ADR-004](../docs/adr/) and in the header comments of
`packages/physics/src/math/`:

- Quaternion order `(x, y, z, w)` with `w` scalar, Hamilton algebra.
- Right-handed world frame.
- Inertia tensor is symmetric, expressed in the body frame, and constant
  within a single integrator step. Variable mass / propellant depletion lands
  in [SLS-9](https://yanismuzenitov.atlassian.net/browse/SLS-9).

## Translational equations of motion

Newton's second law in the world frame:

```
dx/dt = v
dv/dt = F / m
```

The caller is responsible for assembling `F` — gravity, drag, thrust (after
rotating the body-frame thrust vector through `q`), tower contact reactions,
etc.

## Rotational equations of motion

### Attitude kinematics

The time derivative of the attitude quaternion under a body-frame angular
velocity `ω`:

```
dq/dt = ½ · q ⊗ ω̄
```

where `ω̄ = (ωₓ, ω_y, ω_z, 0)` is `ω` embedded as a pure quaternion (vector
part is the angular velocity, scalar part is zero). The Hamilton product
ordering matches our convention from
[ADR-001](./adr/001-tech-stack.md).

Because RK4 takes Euclidean linear combinations of the derivative, the
intermediate `dq/dt` is **not** a unit quaternion. We absorb that drift by
renormalising `q` once per integrator step (see *Renormalisation* below).

### Euler's equation for angular velocity

In the body frame, with constant `I`:

```
dω/dt = I⁻¹ ( τ − ω × (I · ω) )
```

The `ω × (I·ω)` term is the gyroscopic (cross) coupling. For a body spinning
about a *principal* axis (an eigenvector of `I`), `I·ω ∥ ω`, the cross
product vanishes, and `ω` stays constant under zero torque. For non-principal
axis spin on an asymmetric body, the cross term drives **nutation** —
visible in the integrator test
`torque-free spin on asymmetric body`.

## RK4 step

Let `y = (x, v, q, ω)` and `f(y) = (dx/dt, dv/dt, dq/dt, dω/dt)` as defined
above. Classical fourth-order Runge–Kutta:

```
k₁ = f(y_n)
k₂ = f(y_n + ½·Δt · k₁)
k₃ = f(y_n + ½·Δt · k₂)
k₄ = f(y_n + Δt · k₃)

y_{n+1} = y_n + (Δt / 6) · ( k₁ + 2·k₂ + 2·k₃ + k₄ )
```

`mass` and `inertia` are pulled out of the derivative loop — they are
constant within the step, so the integrator computes `I⁻¹` once and reuses
it across all four stages.

## Renormalisation

After the RK4 update, `q` is no longer guaranteed to be unit-norm because
each `k_i.dAttitude` is a tangent vector to the unit-quaternion manifold
rather than a point on it. Without correction the attitude representation
slowly becomes a shear, not a rotation. We therefore normalise once per
step:

```
q_{n+1} := q_{n+1} / ||q_{n+1}||
```

This is the cheapest correction that preserves rotational interpretation
exactly. Higher-order projection schemes (e.g. orthonormalising the rotation
matrix) exist but are not needed for our integration error envelope.

## Conserved quantities (sanity checks)

For zero-torque motion these quantities are exactly conserved in continuous
time, and conserved to RK4 accuracy in our integrator (verified in
`integrator.test.ts`):

- Rotational kinetic energy: `T_rot = ½ ωᵀ · I · ω`
- Angular momentum magnitude: `||L|| = ||I · ω||` (the vector `L` rotates
  with the body, but its world-frame magnitude is constant)

For ballistic motion under constant gravity, total mechanical energy is
conserved:

- `E = ½ m ||v||² + m g h`

These checks form the property tests for the integrator. They catch sign
errors and missing terms more reliably than position-snapshot tests do.

## References

- Marion & Thornton, *Classical Dynamics of Particles and Systems*, ch. 11
  (Euler's equations, rigid-body rotation).
- Roy Featherstone, *Rigid Body Dynamics Algorithms* — a reference for
  spatial-vector formulations we may adopt later if multi-body scenarios
  (e.g. articulated chopsticks) need it.
- Shoemake, *Animating Rotation with Quaternion Curves*, SIGGRAPH 1985 —
  source of the half-angle quaternion kinematics formula used above.
- David Baraff, *Physically Based Modeling: Rigid Body Simulation*, SIGGRAPH
  course notes — concise treatment of integration + quaternion drift.
