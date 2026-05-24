import { Bloom, EffectComposer, SMAA } from "@react-three/postprocessing";

export function PostFX() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom intensity={0.25} luminanceThreshold={0.85} mipmapBlur />
      <SMAA />
    </EffectComposer>
  );
}
