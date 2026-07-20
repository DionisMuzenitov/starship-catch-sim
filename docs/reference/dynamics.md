# Dynamics reference — body drag Cd(M) + atmosphere temperature

Machine-consumed constants live in the code (`packages/physics/src/drag.ts`,
`packages/physics/src/atmosphere.ts`); this note records where the numbers
came from and when they were checked, per `docs/reference/README.md`.

## Cd(M) — Mach-dependent body drag (SLS-45)

### Model

`bodyDragForce` scales the vehicle's subsonic plateau Cd (`bodyCd`, e.g.
0.7 for the booster) by a normalized multiplier curve `cdAt(M)`:

| Mach | multiplier | basis |
|------|-----------|-------|
| 0.00 | 1.00 | subsonic plateau |
| 0.60 | 1.00 | drag-divergence onset — SALTO data already rising at M 0.6 |
| 0.90 | 1.25 | SALTO ratio ≈ 1.2–1.25× plateau |
| 1.10 | 1.55 | interpolation between measured anchors |
| 1.50 | 1.80 | broad peak — CALLISTO peak location, SALTO magnitude ratio |
| 2.00 | 1.78 | SALTO M 2.0 anchor (CX ≈ 2.3 max of campaign) |
| 3.00 | 1.60 | SALTO M 3.0 anchor |
| 5.00 | 1.50 | asymptote (engineering estimate); held constant beyond |

Interpolation: cubic smoothstep between adjacent breakpoints (C1 at every
join, zero slope at breakpoints, no overshoot). Below M 0.6 the output
equals the plateau exactly, so subsonic behaviour is bit-identical to the
pre-SLS-45 constant-Cd model.

### Why this shape

A booster descending **engines-first (retrograde, grid fins deployed)** is a
blunt body, not a slender ascending rocket. Wind-tunnel campaigns on
Falcon-9-class retro-landing demonstrators show:

- drag divergence starts early (~M 0.6), rise already under way at M 0.9;
- a **broad peak near M 1.4–1.5** (not the sharp M ≈ 1.1 spike of slender
  bodies);
- only **mild supersonic decay** — ~8 % from M 2 to M 3 — with the
  high-Mach value staying well above the subsonic plateau.

The subsonic plateau itself cross-checks: Hoerner gives Cd ≈ 0.81 for a
flat-faced cylinder in axial flow (l/d > 2, frontal reference area), and
deployed grid fins add ΔCX ≈ 0.2–0.3 → ≈ 1.0 total. Our booster uses
`bodyCd = 0.7` with the grid-fin contribution modelled separately in the
aero-surfaces layer, which keeps the split consistent.

### Known limitations (v1)

- **Isotropic**: one Cd regardless of angle of attack. AoA-dependent body
  aero stays in the aero-surfaces layer (SLS-12 lineage).
- **No plume interaction**: during retropropulsion burns the engine plume
  displaces the stagnation flow and the aerodynamic drag largely collapses
  (NASA supersonic-retropropulsion flight data). We still apply full Cd(M)
  while engines burn — conservative for the controller, wrong for fuel
  accounting at the margin. Candidate follow-up ticket.
- **Fin-size scaling**: SALTO's grid fins are proportionally larger than a
  Super-Heavy-like layout, so we scale SALTO's *ratios*, not its absolute
  CX values.

## Atmosphere temperature + speed of sound (SLS-45)

`temperatureAt(h)` implements the **U.S. Standard Atmosphere 1976** layer
structure (identical to ISO 2533 in this range): 288.15 K at sea level,
−6.5 K/km to 11 km, isothermal 216.65 K to 20 km, +1.0 K/km to 32 km,
+2.8 K/km to 47 km, isothermal 270.65 K to 51 km, −2.8 K/km to 71 km,
−2.0 K/km to 84.852 km, clamped above. Speed of sound `a = √(γ·R·T)` with
γ = 1.4, R = 287.05 J/(kg·K).

Approximations, documented on purpose:

- **Density/pressure stay exponential** (scale heights 8.5 / 7.4 km) — the
  ISA temperature rides alongside. Cd(M) needs Mach to ~±0.05 only, and the
  exponential density is within ~10 % of ISA below 50 km where drag matters.
- Layer altitudes are geopotential; we treat them as geometric (< 1 %
  altitude error below 60 km, ~1.5 % at 100 km — matches the code
  comment in `atmosphere.ts`).

## Descent profile + landing-burn fuel budget (SLS-80)

**Real Super Heavy (Flight 5, Oct 2024).** The booster re-enters on
aerodynamics + **grid fins**, engines off, through most of the descent. With
~1 km to go it lights the **central 13 engines** for the landing burn to shed
velocity, then drops to the **central 3** for the near-hover + horizontal slide
onto the chopstick arms, and shuts down at the catch. It retains only about
**7 % propellant reserve** for that vertical landing — enough to null the
velocity with margin to divert to a sea splashdown as a safety abort. So the
realistic profile is: **long unpowered aero descent → short, late landing burn
on a bounded reserve.**

**Simulator fuel budget** (single-sourced; `presets/super-heavy.ts`,
`scenarios.ts`, mirrored in `services/rl/rl_consts.json`):

| Quantity | Value |
|---|---|
| Dry mass | 200 t |
| Full tank | ≈ 3 274 t (π·r²·h·ρ, r = 4.5 m, h = 62 m, ρ = 830 kg/m³) |
| `booster-descent-*` start | 10 % of tank = **327.4 t** (`INITIAL_FUEL_FRACTION = 0.1`) |
| Raptor | thrust 2.05 MN (SL) / 2.3 MN (vac); Isp 327 / 350 s; min throttle 0.4 |

**Realism gap (ADR-023).** The shipped booster policy keeps the centre engines
lit through the *whole* coast (~231 t burned) — it is behaviour-cloned from a
scripted teacher (`services/rl/src/rl/cascade.py`) that holds the centre ring at
0.45 throttle for attitude authority. This is unphysical vs the profile above;
the fix (coast on fins, burn late) is deferred to SLS-89 because it needs a
policy re-clone and may trade catch rate. The **MPC** already encodes the
realistic coast+burn with a min-fuel objective + reserve constraint (ADR-009).

## Sources (accessed 2026-07-04)

1. Hoerner, S.F., *Fluid-Dynamic Drag*, 1965 — axial-flow cylinder Cd via
   [Aerospaceweb, "Drag of Cylinders & Cones"](https://aerospaceweb.org/question/aerodynamics/q0231.shtml).
2. Marwege, Zhai, Klevanski, Gülhan — ["Aerodynamic Behavior of a Descending
   Launcher First Stage Demonstrator with Grid Fins in the Aerodynamic
   Phase"](https://www.researchsquare.com/article/rs-8914583/v1) (SALTO T3,
   DLR trisonic wind tunnel), Research Square preprint, 2026. CX at
   α = 180°: ≈1.25–1.3 (M 0.6), ≈1.5 (M 0.9), ≈2.3 (M 2.0, campaign max),
   ≈2.1 (M 3.0); grid fins add ΔCX ≈ 0.2–0.3.
3. Marwege, Riehmer, Klevanski, Gülhan, et al. — ["First Wind Tunnel Data of
   CALLISTO"](https://www.eucass.eu/doi/EUCASS2019-0350.pdf), EUCASS 2019,
   DOI 10.13009/EUCASS2019-350 — retrograde fins-deployed Cd peaks near
   M 1.4–1.5, near-flat decline supersonic.
4. Marwege et al. — ["Wind tunnel experiments of interstage segments used
   for aerodynamic control of retro-propulsion assisted landing
   vehicles"](https://link.springer.com/article/10.1007/s12567-022-00425-4),
   CEAS Space Journal, 2022 — same qualitative shape.
5. [U.S. Standard Atmosphere 1976 — SDSU explainer](https://aty.sdsu.edu/explain/thermal/std_atm.html);
   [Wikipedia, "U.S. Standard Atmosphere"](https://en.wikipedia.org/wiki/U.S._Standard_Atmosphere).
6. NASA — ["Advancing Supersonic Retropropulsion Using Mars-Relevant Flight
   Data"](https://ntrs.nasa.gov/api/citations/20170008725/downloads/20170008725.pdf),
   NTRS 20170008725, 2017 — plume-drag interaction caveat.
7. Super Heavy Flight 5 catch (descent profile + landing burn 13→3 engines,
   ~7 % reserve; accessed 2026-07-20): [NASASpaceflight, "Starship Flight 5
   catch"](https://www.nasaspaceflight.com/2024/10/starship-flight-5-catch/);
   [Wikipedia, "SpaceX Super Heavy"](https://en.wikipedia.org/wiki/SpaceX_Super_Heavy).
