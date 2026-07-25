# Rendering performance budget + quality tiers (SLS-61)

How the sim keeps a playable frame rate on the owner's reference laptop, and the
honest answer to "should we rent a GPU server?".

## The budget

The scene is geometrically **light** — one vehicle GLB, a static terrain
heightfield, one tower GLB, sky + fog, and an instanced-cone plume (single draw
call). There is no shadow pass. So the dominant cost is **pixels shaded**, i.e.
the renderer pixel ratio (`dpr`), plus the two full-screen post passes (Bloom +
SMAA). On a hi-dpi (retina) laptop, native `dpr = 2` shades ~4× the fragments of
`dpr = 1` — that one lever swings frame time far more than any geometry change.

**Target:** ≥ 60 fps (≤ 16.7 ms/frame) at the **default (medium)** tier on the
reference laptop, across all camera modes, with Earth terrain + tower + plumes.
This is the M8 outcome gate (SLS-71). 30 fps is the floor for the **high** tier.

## Quality tiers

Selected in-app (top-left `quality:` picker, persisted to localStorage) and
applied at runtime — no reload. Implemented in `apps/web/src/state/qualityStore.ts`
(`TIERS`) + `QualityController` (dpr).

The one lever is the renderer **pixel ratio** (`dpr`), clamped to the device
ratio. It dominates on this light scene, and because the full-screen post passes
(Bloom + SMAA) cost scales with pixel count, `dpr` moves them too — so both stay
on every tier and antialiasing is never dropped.

| Tier | `dpr` cap (clamped to device) | Intended for |
|---|---|---|
| **low** | 1.0 | weak GPU / battery; guarantees frame rate |
| **medium** (default) | 1.5 | the 60 fps target tier |
| **high** | 2.0 (native) | crisp capture / strong GPU |

Bloom + SMAA run on every tier. Clouds are **not** implemented; if added they
are a HIGH-tier-only feature (impostor/skybox first, volumetrics only if the
budget allows) per the ticket.

## Measuring (perf HUD)

The **perf** checkbox in the quality picker shows the frame-time HUD
(`fps · avg ms (worst ms)`). Worst-frame is the number that matters for judder —
a good average hides hitches. It defaults **on** (owner preference — fps is a
feature on a technical demo); uncheck it for a clean capture (SLS-64).

**Baseline (reference laptop, owner-measured 2026-07-25):** at the **default
medium tier**, all six camera modes hold **≈ 60 fps** with Earth terrain + tower
+ plumes firing. **The M8 outcome gate (≥ 60 fps default tier — SLS-71) is MET.**
The measurement was coarse ("≈60 everywhere"); the tiers remain as headroom (drop
to **low** on weaker hardware, **high** for crisp capture). Re-measure per-mode
only if a future visual ticket adds cost.

| Camera mode | medium (default) |
|---|---|
| chase / tower / ground / onboard / cinematic / free | ≈ 60 fps ✅ |

## Remote-compute question — recommendation

The concern was whether to rent a GPU server for an hour if the laptop can't
render the stack. **The sim is client-side WebGL: a rented server does not
render the user's browser.** Options, honestly compared:

1. **Quality tiers + resolution scaling (this ticket) — recommended, almost
   certainly sufficient.** The scene is one vehicle + terrain; `dpr` scaling
   alone recovers most of the cost. No infra, no latency, works for every
   visitor to the public demo, not just the owner.
2. **Rent a GPU box for OFFLINE demo-video capture — useful, narrowly.** SLS-33
   needs a polished cinematic clip, which is *not* realtime: render the cinematic
   camera at high tier + high `dpr` (even super-sampled) to an offline capture,
   slower-than-realtime if needed. A beefy machine for an hour genuinely helps
   *here* — for footage, not for interactive play.
3. **Pixel-streaming the app from a GPU server — rejected (overkill).** Running
   headless WebGL/Chromium on a cloud GPU and streaming H.264 to the browser
   would move rendering off the client, but it adds a GPU VM, an encoder, a
   low-latency transport, and per-viewer cost — heavy infra to avoid a
   `dpr` slider on a one-vehicle scene. Only worth revisiting if the visual
   stack grows an order of magnitude (dense city, volumetric weather) AND the
   demo must run interactively on very weak clients.

**Bottom line:** ship the tiers locally (done); rent a GPU only for the offline
SLS-33 video capture if the laptop can't render the high-tier cinematic in real
time. Do not build pixel-streaming.

## Sources / notes

- Cost model is first-principles (fragment count ∝ `dpr²`; Bloom + SMAA are
  full-screen passes) — confirm against the measured baseline table above.
- WebGL is single-client by nature (MDN, three.js docs); there is no server-side
  render path for a `<canvas>` short of pixel-streaming.
