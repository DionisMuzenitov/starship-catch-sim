# Convex powered-descent guidance — the Açıkmese/Blackmore lineage

> Migrated from the Confluence SLS space (SLS-118). Confluence was lost when
> the free trial ended (SLS-68); this file is now the canonical copy.
> Source: `confluence-kb.json` export of 2026-08-19, page version 1.

## Convex powered-descent guidance — the A&ccedil;ıkmese/Blackmore lineage

**Purpose:** narrative KB reference behind ADR-007 (repo: `docs/adr/007-convex-mpc-guidance.md`). Why rocket-landing guidance is solved with convex optimization, what "lossless convexification" means, and which papers anchor our M5 MPC. Added 2026-07-04 during SLS-25.

### The problem

Powered-descent guidance ("PDG"): given the current position/velocity/mass, find a thrust program that lands at a target with bounded speed, using minimum fuel, while respecting (a) a thrust **lower** bound — rocket engines can't throttle to zero, ours floor at 40 % — (b) a thrust pointing cone, and (c) a glide-slope cone keeping the trajectory above terrain / clear of structures. Constraints (a)+(b) make the feasible control set **nonconvex** (an annulus-with-cone), which normally means no guarantee a solver finds the optimum, let alone quickly.

### The key result — lossless convexification

A&ccedil;ıkmese & Blackmore (IEEE TCST 2013) proved the 3-DOF problem admits an **exact** convex relaxation: introduce a slack &Gamma; with ‖T‖ &le; &Gamma; and move the bounds onto &Gamma;. The relaxed problem is a second-order cone program (SOCP), solvable to global optimality in polynomial time — and (the "lossless" part, via Pontryagin) its optimum provably satisfies ‖T‖ = &Gamma;, i.e. it _is_ the optimum of the original nonconvex problem. A logarithmic change of variables z = ln m makes mass depletion linear too. This became **G-FOLD**, flight-tested by JPL/Masten on Xombie, and the intellectual ancestor of what SpaceX flies (Blackmore led Falcon landing GNC; see his 2016 NAE Bridge article).

Standard constraint forms (all SOCP-compatible): glide slope ‖r_horizontal &minus; r_f,h‖ &le; tan(&theta;)·(r_vertical &minus; r_f,v); pointing T_up &ge; &Gamma;·cos(&theta;_max); terminal velocity box.

### Extensions we care about

- **6-DOF + free final time:** Szmuk & A&ccedil;ıkmese (AIAA 2018) — attitude, angular rate, and gimbal in the state; solved by **successive convexification (SCvx)**: linearize about the current trajectory, solve an SOCP, repeat. Real-time-capable variants exist (Reynolds et al. 2018) but there is no global-convergence guarantee — this is our SLS-27 upgrade path, not the baseline.
- **Survey:** Malyuta et al. 2023 ("Convex Optimization for Guidance and Control of Vehicular Systems") is the best single map of the field.

### How our simulator uses this (ADR-007 summary)

3-DOF lossless-convex SOCP re-planned at 1 Hz (min-fuel, N = 60 nodes, drag linearized about the previous plan using the SLS-45 Cd(M) table), with the ADR-006 cascaded PID tracking the planned trajectory at 250 Hz. Catch-specific geometry: the glide cone apexes at the **physical chopstick slot centre** (&asymp; (8.5, 91, 0)), not the tower centreline — the tower rises 55 m above the catch height, so the centreline admits no usable cone — plus a convex +x half-space keep-out for the tower body. Solver: CVXPY + Clarabel behind a FastAPI service (SLS-26); browser/WASM story deferred to SLS-27.

### Sources (accessed 2026-07-04)

1. A&ccedil;ıkmese, B., Blackmore, L. — _Lossless Convexification of Nonconvex Control Bound and Pointing Constraints of the Soft Landing Optimal Control Problem_, IEEE Trans. Control Systems Technology, 2013. [http://www.larsblackmore.com/iee_tcst13.pdf](http://www.larsblackmore.com/iee_tcst13.pdf)
2. Blackmore, L. — _Autonomous Precision Landing of Space Rockets_, NAE The Bridge, 2016. [http://larsblackmore.com/nae_bridge_2016.pdf](http://larsblackmore.com/nae_bridge_2016.pdf) (overview + G-FOLD/Xombie flight tests)
3. Szmuk, M., A&ccedil;ıkmese, B. — _Successive Convexification for 6-DoF Mars Rocket Powered Landing with Free-Final-Time_, AIAA SciTech 2018. [https://arxiv.org/abs/1802.03827](https://arxiv.org/abs/1802.03827)
4. Reynolds, T., et al. — _Real-Time 6-DoF Powered Descent Guidance_, 2018. [https://arxiv.org/pdf/1811.10803](https://arxiv.org/pdf/1811.10803)
5. Malyuta, D., et al. — _Convex Optimization for Guidance and Control of Vehicular Systems_ (survey), 2023. [https://arxiv.org/pdf/2311.05115](https://arxiv.org/pdf/2311.05115)
6. Glide-slope constraint form: NASA NTRS 20160012101. [https://ntrs.nasa.gov/api/citations/20160012101/downloads/20160012101.pdf](https://ntrs.nasa.gov/api/citations/20160012101/downloads/20160012101.pdf)
7. CVXPY default open-source conic solver → Clarabel: [https://github.com/cvxpy/cvxpy/discussions/2178](https://github.com/cvxpy/cvxpy/discussions/2178)
