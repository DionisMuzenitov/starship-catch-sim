# apps/web/src/scene

Base 3D scene for the Starship catch simulator. Composed as React Three Fiber
components and mounted by `<Scene />`, which is rendered from `App.tsx`.

## World convention

- **Up axis:** `+Y`
- **Origin:** base of the catch tower (`Mechazilla`)
- **Units:** SI metres
- **Camera depth:** logarithmic depth buffer enabled (near `0.5 m`, far
  `200 km`) so we can resolve detail on the booster and still show the sky
  100 km up without z-fighting.

If you add new scene objects, place them in world metres relative to the
origin above. Vehicles, towers, ground features all share this frame.

## File map

- `constants.ts` — sizes, colours, fog/transition thresholds.
- `Ground.tsx` — 50 km × 50 km plane with a programmatic 100 m grid texture.
- `Sky.tsx` — gradient sphere + procedural starfield. Crossfades 40–60 km of
  camera altitude (`SKY_TRANSITION_START_M` / `SKY_TRANSITION_END_M`): sky
  fades out, stars fade in linearly across that band. Both meshes follow the
  camera so they never feel "close".
- `Sun.tsx` — fixed-angle directional light + low ambient.
- `Fog.tsx` — `FogExp2` with density `0.0003` (≈ 5 km visibility at sea
  level). Single setting for v1; altitude-aware fog can come later.
- `PostFX.tsx` — `EffectComposer` with subtle `Bloom` + `SMAA`. No chromatic
  aberration. Canvas `antialias` is off because SMAA handles AA.
- `BoosterPlaceholder.tsx` — 70 m × 4.5 m radius cylinder at origin, stands
  in for the real booster geometry from a later ticket.
- `DebugOverlay.tsx` — `DebugSampler` (inside `<Canvas>`, uses `useFrame` for
  rAF-driven EMA-smoothed FPS + camera position) and `DebugHud` (DOM sibling
  rendered absolute-positioned at top-left).
- `Scene.tsx` — root composer. Owns the debug sample state shared between
  the in-Canvas sampler and the DOM HUD.

## Tuning notes

- Star count is fixed (1500). They sit on a sphere of radius 120 km, biased
  to the upper hemisphere, and are billboarded as fixed-size points (no
  size attenuation).
- The sky sphere is 150 km radius and follows the camera; this matters when
  the camera goes high enough that a stationary sphere would clip into it.
- Bloom threshold is intentionally high (0.85) so only emissive highlights
  bloom; we don't want the bright ground / sky washing out.
