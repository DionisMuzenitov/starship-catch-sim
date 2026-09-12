# Booster descent aerodynamics — retrograde blunt-body drag & Cd(M)

> Migrated from the Confluence SLS space (SLS-118). Confluence was lost when
> the free trial ended (SLS-68); this file is now the canonical copy.
> Source: `confluence-kb.json` export of 2026-08-19, page version 1.

## Booster descent aerodynamics — retrograde blunt-body drag & Cd(M)

**Purpose:** narrative reference for how a Super-Heavy-class booster's drag behaves during the engines-first descent, and where our simulator's Cd(M) curve comes from. Machine-consumed values live in the repo (`packages/physics/src/drag.ts`, rationale in `docs/reference/dynamics.md`); this page is the "why", per the KB conventions. Added 2026-07-04 during SLS-45.

### The key physical picture

A booster falling **engines-first** (retrograde, grid fins deployed) is a _blunt body_, not a slender rocket:

- The flat interstage/skirt face and open engine nozzles force flow separation at the sharp edge — subsonic Cd is already high (&asymp; 0.8 for a bare flat-faced cylinder per Hoerner, &asymp; 1.0 with grid fins deployed).
- **Drag divergence starts early**, around Mach 0.6 — earlier than the ~0.8 rule-of-thumb for slender bodies.
- The drag coefficient **peaks broadly around Mach 1.4–1.5** at roughly 1.8× the subsonic plateau.
- Supersonic decay is **mild** (&asymp; 8 % from Mach 2 to 3), and the high-Mach value stays _well above_ the subsonic plateau. This is the opposite of the sharp M &asymp; 1.1 spike-and-decay familiar from ascending rockets — worth remembering whenever tuning controllers around the transonic regime.

### Where the numbers come from

The best open data is from DLR's trisonic wind-tunnel campaigns on Falcon-9-class vertical-landing demonstrators:

- **SALTO T3** (Marwege, Zhai, Klevanski, G&uuml;lhan — Research Square preprint rs-8914583/v1, 2026, accessed 2026-07-04): CX at &alpha; = 180° (pure retrograde, fins deployed): &asymp; 1.25–1.3 at M 0.6 → &asymp; 1.5 at M 0.9 → &asymp; 2.3 at M 2.0 (campaign maximum) → &asymp; 2.1 at M 3.0. Grid fins add &Delta;CX &asymp; 0.2–0.3. Note SALTO's fins are proportionally larger than a Super-Heavy-like layout, so we use their _ratios_, not absolute values. [https://www.researchsquare.com/article/rs-8914583/v1](https://www.researchsquare.com/article/rs-8914583/v1)
- **CALLISTO** (Marwege et al., EUCASS 2019, DOI 10.13009/EUCASS2019-350, accessed 2026-07-04): confirms the shape — retrograde fins-deployed Cd rises subsonically, peaks near M 1.4–1.5, near-flat decline supersonic. [https://www.eucass.eu/doi/EUCASS2019-0350.pdf](https://www.eucass.eu/doi/EUCASS2019-0350.pdf)
- **Hoerner**, _Fluid-Dynamic Drag_ (1965): flat-faced cylinder in axial flow, l/d > 2 → Cd &asymp; 0.81 on frontal area (via Aerospaceweb, accessed 2026-07-04). [https://aerospaceweb.org/question/aerodynamics/q0231.shtml](https://aerospaceweb.org/question/aerodynamics/q0231.shtml)

### What the simulator does with this (SLS-45)

`cdAt(M)` scales each vehicle's subsonic `bodyCd` by a smoothstep-interpolated multiplier table: 1.0 up to M 0.6, 1.25 @ M 0.9, 1.55 @ M 1.1, **1.8 @ M 1.5 (peak)**, 1.78 @ M 2, 1.6 @ M 3, 1.5 @ M 5+ (held). Mach comes from ISA/USSA-1976 layer temperatures (`speedOfSoundAt`); density stays the v1 exponential model — the mismatch is deliberate and documented, since Cd(M) only needs Mach to about ±0.05.

### Known gaps (candidate future tickets)

- **Plume interaction:** during retropropulsion burns the plume displaces the stagnation flow and aerodynamic drag largely collapses (NASA SRP flight data, NTRS 20170008725, accessed 2026-07-04). We currently apply full Cd(M) even while burning — conservative for control, slightly wrong for fuel accounting. [https://ntrs.nasa.gov/api/citations/20170008725/downloads/20170008725.pdf](https://ntrs.nasa.gov/api/citations/20170008725/downloads/20170008725.pdf)
- **Angle of attack:** body drag is isotropic in v1; AoA effects live in the aero-surfaces layer.
