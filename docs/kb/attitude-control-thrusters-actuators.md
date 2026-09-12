# Attitude control, thrusters & actuators

> Migrated from the Confluence SLS space (SLS-118). Confluence was lost when
> the free trial ended (SLS-68); this file is now the canonical copy.
> Source: `confluence-kb.json` export of 2026-08-19, page version 2.

How Starship steers and holds its orientation — reaction-control thrusters and the flight-control actuators — and the failure modes that have actually bitten in flight. This is the most directly control-relevant reference we have, drawn from the Starbase interview and per-flight observation.

### Source

📺 [Everyday Astronaut — Starbase tour with Elon Musk](https://www.youtube.com/watch?v=aFqjoCbZ4ik) (transcript on file). Several claims below are paraphrased from that conversation; the engine-ring / landing-burn additions (2026-05-28) are sourced separately — see Sources.

### How much control authority is actually needed

The attitude-control (RCS) job is small: the delta-V needed to settle propellant and hold/adjust orientation is tiny, so the thrusters themselves are small. The hard requirement isn't power — it's **reliability**: you can't have a leaky or stuck valve. For reference, Falcon 9's RCS is _all cold gas_ (nitrogen) and has held attitude and propellant settling across many-hour coasts and multiple restarts.

### Thruster vocabulary

- **Cold gas** — room-temperature stored gas (e.g. nitrogen) expelled through a nozzle. Simple and reliable; Falcon 9 uses this.
- **Warm gas** — same idea but the gas is warm (e.g. tank ullage gas).
- **Hot gas** — a propellant reaction (effectively a small bipropellant thruster).

Starship uses hot/warm-gas thrusters fed from the engine system rather than a separate cold-gas system.

### Starship's hot-gas thrusters — and the ice failure

Starship taps thruster gas from the engine's **oxygen-rich preburner** flow. Because that tap isn't pure O₂ — it carries a little burnt fuel — it contains trace species (water, CO₂) that can freeze solid at cryogenic temperatures. On a flight, that **ice clogged the roll-thruster valves**, costing roll/attitude control during the critical phase.

The fixes discussed:

- Improved **ice strainers / catchers** upstream of the valves.
- Improved **valves**.
- Moving critical valves to **series–parallel redundancy**, so no single valve failure can take out the ability to orient the vehicle.

Related: on an earlier booster flight, low tank pressure (an autogenous-pressurization shortfall, same family of problem) meant there wasn't enough pressure to start all the boostback engines. Pressure and ice management around the engine taps are recurring reliability themes.

### Actuation is all-electric

- **Engine gimbal is electric** (not hydraulic). The central engines gimbal to steer and to fly the landing burn.
- **Grid fins and body flaps are driven by Tesla drive units** (electric motors).
- **Flaps need very powerful actuators** — moving them is like an airplane moving its wings, so the forces are large.
- The vehicle is essentially **hydraulics-free** (pneumatics still run many valves).

### Super Heavy: engine rings, gimbal subset & landing-burn sequencing

_Added 2026-05-28. Sourced — see Sources. This is the layer the simulator's engine plant + booster-descent scenario need to get right._

**Ring layout (Block 1/2, 33 engines):** three concentric groups — **3 center**, **10 middle ring**, **20 outer ring**.

**Which engines gimbal (control authority):** only the **inner 13** (3 center + 10 middle) can gimbal / thrust-vector. The **outer 20 are fixed** (no gimbal) — they are pure thrust, no steering. So all engine-based attitude authority comes from the inner 13.

**Landing-burn sequencing (the part observed in the videos):**

- Descent before the burn is flown **aerodynamically on the grid fins** (engines off).
- At ~1 km the **landing burn lights 13 engines** (the 3 center + the 10 middle ring) to kill velocity fast — i.e. "all except the outer ring," matching the owner's observation.
- Once the deceleration target is met, the **10 middle-ring engines shut down**, leaving the **3 center engines** for the fine-control hover and the catch. Many engines are great for braking but too coarse for terminal fine control — hence the step-down.
- Boostback similarly relights the inner ring / 13.

**Block 3 nuance (forward-looking):** Block 3 keeps 33 engines but feeds the inner 13 from a **separate LOX landing tank** and can start **any of the inner 13** for redundancy; the center/middle engines are slightly rotated (asymmetric) to enable a new landing-burn startup sequence. Grid fins also move from **4 → 3**, 50% larger, mounted lower, enabling higher angle-of-attack descent.

**What this means for the simulator.** The engine plant needs per-engine identity, not a single lumped thrust: (a) a gimbal flag (inner 13 yes / outer 20 no), and (b) per-engine on/off so the scenario can script the 33 → 3+10 → 3 sequence. Control allocation must know that only gimballing engines contribute steering torque.

### Booster roll control — and why it's the interesting case

_Added 2026-05-28. The owner flagged this as a likely implementation-time discovery; here is the grounded picture plus the genuinely open questions._

**The problem the owner spotted is real.** The gimballing engines are clustered close to the **longitudinal (roll) axis**, so vectoring their thrust produces strong **pitch/yaw** torque but only weak **roll** torque (small moment arm about the centerline). Engines alone are a poor roll effector.

**How roll is actually controlled:**

- **In the atmosphere:** the **grid fins** are the primary roll (and yaw) authority — they steer the booster aerodynamically and can adjust pitch, yaw, and roll. This confirms the owner's hunch: grid fins, not engines, hold roll on the way down.
- **At low dynamic pressure** (thin air, high altitude, low speed): aerodynamic surfaces produce little force, so orientation falls to the **RCS / hot-gas thrusters** — the same system whose **roll-thruster valves iced up** in the failure noted above. That failure is precisely a _roll-control_ loss, which underlines how load-bearing the non-engine roll path is.

**Open questions for implementation-time investigation (SLS-44/controllers):**

- Quantify the roll-torque budget: grid-fin roll authority vs dynamic pressure (q), and the crossover altitude/speed where fins become effective vs where RCS must carry roll.
- Does **differential gimballing** of the inner ring contribute any usable roll torque, or is it negligible? (Likely small but worth bounding.)
- How should control allocation split the three axes across {gimbal, grid fins, RCS} as a function of flight phase? This is a real design decision for the PID/MPC/RL controllers (SLS-23..30), not just a physics constant.

### Modeling priority (control effectors)

Model the control effectors in priority order: **gimballed thrust** (primary for pitch/yaw, inner 13 only, electric, fast/repeatable), **grid fins** (aerodynamic steering — primary roll/yaw on the booster, 3–4 surfaces), **body flaps** (high-force aerodynamic control on the ship), and **small RCS thrusters** (bounded, low-authority torque for orientation/settling, dominant at low q). Electric actuation justifies treating actuator response as fast and deterministic. The RCS ice-clog failure is a good candidate for a reliability/fault-injection scenario, and the series–parallel redundancy is the mitigation to model.

### Sources

- [Everyday Astronaut — Starbase tour with Elon Musk](https://www.youtube.com/watch?v=aFqjoCbZ4ik) (YouTube) — transcript on file
- [Everyday Astronaut — Starship/Super Heavy Flight 4 vehicle guide](https://everydayastronaut.com/starship-super-heavy-flight-4/) — ring layout (3/10/20) and which engines gimbal (inner 13)
- [SpaceX Super Heavy — Wikipedia](https://en.wikipedia.org/wiki/SpaceX_Super_Heavy) — inner 13 on thrust puck, outer 20 on ring; chines for descent lift
- [Super Heavy Block 3 — NASASpaceflight](https://www.nasaspaceflight.com/2026/05/super-heavy-block-3-booster-future/) — separate LOX landing tank feeding inner 13, any-of-13 start redundancy, new landing-burn sequence
- "Super Heavy catch" explainers (Ars/Ad Astra, The Register) — landing burn 13 → 3 engine step-down at ~1 km
- [Reaction control system](https://en.wikipedia.org/wiki/Reaction_control_system) (Wikipedia) — background on RCS / thruster types
