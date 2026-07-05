/**
 * Shared access to the clarence365 stack GLB (SLS-44). One file holds both
 * vehicles as named subtrees; each loader clones the subtree it needs.
 *
 * The GLB is Draco-compressed, so the decoder is self-hosted under
 * `public/draco/` (base-path aware — no CDN, works offline and on the
 * GitHub Pages sub-path). See ADR-012.
 */

import { useGLTF } from "@react-three/drei";
import type { Group } from "three";

const BASE = import.meta.env.BASE_URL;
export const STACK_GLB_URL = `${BASE}assets/starship-stack.glb`;
export const DRACO_DECODER_PATH = `${BASE}draco/`;

type GLTFResult = { scene: Group };

/** Load (and cache) the stack GLB with the self-hosted Draco decoder. */
export function useStackScene(): Group {
  const { scene } = useGLTF(
    STACK_GLB_URL,
    DRACO_DECODER_PATH,
  ) as unknown as GLTFResult;
  return scene;
}

useGLTF.preload(STACK_GLB_URL, DRACO_DECODER_PATH);
