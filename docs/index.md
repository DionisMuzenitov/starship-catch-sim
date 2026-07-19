---
layout: home

hero:
  name: Starship Catch Simulator
  text: Catch the Super Heavy booster, in your browser.
  tagline: An open-source 6-DOF flight sim of the Mechazilla catch — with PID, MPC, and a trained RL policy you can watch fly, and the physics + derivations behind them.
  actions:
    - theme: brand
      text: ▶ Play the demo
      link: https://dionismuzenitov.github.io/starship-catch-sim/
    - theme: alt
      text: Quick start
      link: /quick-start
    - theme: alt
      text: GitHub
      link: https://github.com/DionisMuzenitov/starship-catch-sim

features:
  - title: Real 6-DOF physics
    details: A shared rigid-body core (mass depletion, ISA atmosphere, Mach-dependent drag, gimballed thrust, aero surfaces) integrated at a fixed step — the same maths, ported TS ↔ numpy and parity-tested.
    link: /dynamics
    linkText: Read the dynamics
  - title: Four ways to fly it
    details: Manual stick, a cascaded PID, a convex-MPC guidance service, and a reinforcement-learning policy trained against the catch envelope. Swap between them live.
    link: /controllers/
    linkText: How the controllers work
  - title: Write your own controller
    details: The Controller interface is one method. Import the physics package, return a control vector, and drop your agent into the loop. A 30-line example to start from.
    link: /api/controllers
    linkText: Build a controller
  - title: Benchmarked & documented
    details: PID vs MPC vs RL on the same scenarios, plus 20 architecture decision records tracing every load-bearing choice.
    link: /benchmarks
    linkText: See the benchmarks
---
