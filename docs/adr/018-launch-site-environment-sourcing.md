# ADR-018: Launch-site environment sourcing — Pad A era, public-domain terrain bake, CC-BY hardware detail

- **Status:** Accepted
- **Date:** 2026-07-11
- **Tickets:** SLS-56 (research spike), SLS-57 (implementation)
- **Backing data:** [launch-site sourcing comparison](../reference/launch-site-sourcing.md) ·
  [Starbase site reference](../reference/starbase-site.md)

## Context

M8 needs a real place to catch in: Earth terrain, the tower, the pad. Hard
constraints: ADR-005 (CC0/CC-BY only, no NC/SA, no Google Earth rips), the
5 MB-per-file CI blob guard, a keyless static host (GitHub Pages — an API key
cannot be hidden), and canonical physics (`packages/physics/src/tower.ts`
defines the tower/capture geometry; art conforms to it, never the reverse).

The SLS-56 spike verified every load-bearing licence claim against primary
licence texts (six adversarial checks + per-model verification) and surfaced a
site-state fact that reframes the ticket: **Pad A — where all three real
catches happened (B12/B14/B15, Oct 2024–Mar 2025) — was demolished in
Oct 2025.** Mid-2026's only catch-capable pad (Pad B) has different geometry,
zero catches, and no licence-clean community model.

## Decision

1. **Depict the Pad A 2024–25 catch era**, labelled as historical. It is the
   configuration of every real catch, the best match for our physics constants
   (146 m tower, catch plane ≈ 91 m), and the only era with licence-clean
   models and abundant reference. Bonus: NAIP 2024 imagery (flown May–Nov
   2024) captures the site in exactly this era.
2. **Terrain is a committed, baked, public-domain dataset** — never streamed,
   no keys: USGS 3DEP DEM + NAIP drape (near tier, ~10×10 km), 3DEP
   1/3″ + SRTM (Mexico side) + Landsat-class imagery (wide tier), plus an
   ocean plane (shoreline is ~430 m east of the tower). All four commercial
   tile services prohibit committing content (ToS quoted in the sourcing
   note). Wide-tier imagery variants (pure-PD vs a Sentinel-2-enhanced
   Mexico side) are built for owner A/B during SLS-57; pure-PD is the default
   and Sentinel-2 ships only with a recorded per-asset ADR-005 exception
   (its ESA licence is permissive but not CC).
3. **Tower/pad hardware conforms to physics constants**, with visual detail
   adapted from the two verified CC-BY 4.0 community kits (MikeNotBrick
   Thingiverse `thing:5908857`, herbys `thing:5403074`) where adaptation
   beats procedural, and upgraded procedural geometry elsewhere; surfaces
   textured from CC0 PBR libraries (triplanar mapping avoids UV-unwrapping
   print solids). Full CC-BY §3(a) attribution (author, source link, licence
   link, modification statement) goes in `ASSETS.md` + app credits.
4. **Payload budget:** environment assets ≤ ~20 MB total, ≤ 5 MB per file
   (existing CI guard), ≤ ~10 MB on the initial critical path; hi-res drape
   lazy-loads after first paint.

## Red-team vs the SLS-57 gate

Can this meet "full descent at frame budget, physics unchanged"? Payload:
heightmap ≤ 1 MB (the site is tidal flats at ~2 m ASL — relief is texture's
job, not geometry's), drape 3–8 MB, wide tier ~3 MB, hardware detail is
code + small GLBs — fits the budget with headroom. Geometry: ~100–300 k added
triangles on top of the existing 168 k booster — comfortable for integrated
GPUs at 1080p. Known risk: `logarithmicDepthBuffer` is already enabled and
disables early-z; if SLS-61's measurement misses 60 fps, the documented
levers are dynamic-near-plane instead of log depth, drape resolution, and
detail-mesh LOD — none of which invalidate this sourcing decision.

## Consequences

- **Positive:** zero licence risk (every byte PD, CC0, or CC-BY-attributed);
  works offline and in forks (no keys, no quotas); reproducible via a
  committed bake script; visual↔physics alignment by construction.
- **Negative:** imagery is fixed at bake time (no live tiles); Mexico-side
  texture is coarser (15–30 m) unless the Sentinel-2 exception is taken;
  depicting demolished hardware needs a "historical configuration" note in
  the KB/app so nobody mistakes it for current Starbase.
- **Follow-up:** the ADR-005 premise "no licence-clean tower model exists"
  is now false — amended with a back-link to this ADR (decision unchanged).

## Alternatives considered

- **Streamed 3D tiles (Google/Cesium/Mapbox/MapTiler)** — rejected: nothing
  committable under any of their ToS, all need embedded tokens (billing or
  quota liability on a public static site), forks/offline break.
- **Pad B (current) or a two-tower site** — rejected for now: no CC model,
  several dimensions only derivable, zero catches to depict; revisit after
  the first real Pad B catch.
- **Import the CC-BY STL kits wholesale** — rejected as the primary route:
  untextured multi-million-tri print solids at 1:144/1:100 scale would fight
  the blob guard and still need warping onto our catch geometry; used
  selectively for detail instead.
- **Commit raw geodata (1 m DEM / 60 cm NAIP tiles)** — rejected: 10×10 km
  is ~0.4–1.1 GB raw; only downsampled derived assets are committed, with
  the bake script as provenance.
