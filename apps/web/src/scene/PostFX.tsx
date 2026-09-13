/**
 * Post-processing: Bloom (makes the engine plumes glow) + SMAA antialiasing.
 * Both run on every quality tier — the tier lever is the renderer pixel ratio
 * (`dpr`, see `qualityStore` / `QualityController`), which already scales these
 * full-screen passes, so antialiasing is never dropped.
 */

import { Bloom, EffectComposer, SMAA } from "@react-three/postprocessing";

export function PostFX() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom intensity={0.25} luminanceThreshold={0.85} mipmapBlur />
      <SMAA />
    </EffectComposer>
  );
}
