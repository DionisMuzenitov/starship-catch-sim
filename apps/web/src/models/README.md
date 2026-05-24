# apps/web/src/models

Procedural low-poly vehicle models for the simulator. Two top-level
components — `<BoosterModel/>` (Super Heavy) and `<StarshipModel/>` (upper
stage) — bind directly to `EngineState[]` / `SurfaceState[]` arrays produced
by the physics package.

## Conventions

- **No external mesh files.** Everything is built from `CylinderGeometry`,
  `ConeGeometry`, and `BoxGeometry`.
- **Body frame matches physics presets** in `packages/physics/src/presets/`:
  origin at the engine plane (booster) or stage bottom (Starship), `+Y` up
  the long axis.
- **Engine mount positions are read from the physics preset arrays
  (`SuperHeavyEngines`, `StarshipEngines`).** When the layout changes there,
  the model picks it up automatically. Same for `BoosterFins` / `ShipFlaps`.
- **`EngineState[]` / `SurfaceState[]` are passed in parallel** to the
  engine and surface preset arrays. Index `i` of the state array
  corresponds to index `i` of the preset. Components throw on length
  mismatch.

## Material

`MeshStandardMaterial` with `metalness=1`, `roughness=0.3` for the body
(stainless steel look). Engine bells are slightly less reflective.

## Files

- `materials.ts` — module-level cached materials so we don't allocate per
  render.
- `EngineBell.tsx` — one truncated-cone bell, tilts about its mount per
  `gimbalPitch` / `gimbalYaw` from `EngineState`.
- `Flame.tsx` — additive cone with a pre-baked CanvasTexture providing the
  noise turbulence + length fade + colour gradient (white-hot at root → red
  at tip). Length and opacity scale with throttle × atmosphere fade. The
  baked-texture branch was chosen over the value-noise shader: an initial
  `ShaderMaterial` implementation rendered nothing on screen (no shader
  compile errors logged either) and the time-box for SLS-15 didn't justify
  deeper debugging. The CanvasTexture approach is the "or a pre-baked
  texture" branch named in the ticket and is functionally equivalent for
  visual interest. A follow-up ticket can revisit the noise shader.
- `GridFin.tsx` — booster grid fin, hinged about body `+Y`.
- `Flap.tsx` — Starship articulated flap, same hinge convention as the fin.
- `BoosterModel.tsx` — body cylinder + taper + interstage ring + 33
  engines + 4 fins + flames.
- `StarshipModel.tsx` — body cylinder + nose cone + 6 engines (3 SL + 3
  vac) + 4 flaps + flames.
- `index.ts` — barrel export.

## Deviations from SLS-15 ticket text

- **Booster height 71 m, not 70 m.** Matches `SuperHeavyMass.height` from
  the M1 physics preset. The 1 m difference doesn't matter physically but
  we keep visual and physics in lockstep.
- **Engine layout 3-10-20 = 33, not 3-13-20.** The ticket's ratio sums to
  36, while the same ticket also says "33 engines". The M1 preset went
  with the real-world 3-10-20 in
  `packages/physics/src/presets/super-heavy-engines.ts:7-9` and we follow
  that.
