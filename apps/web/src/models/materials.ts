import { MeshStandardMaterial } from "three";

export const STEEL_COLOR = "#c4c8d0";
export const ENGINE_COLOR = "#5a5e66";
export const FIN_COLOR = "#8f939b";

let steelMat: MeshStandardMaterial | null = null;
let engineMat: MeshStandardMaterial | null = null;
let finMat: MeshStandardMaterial | null = null;

// Note on metalness: pure metals (metalness=1) only reflect the environment;
// without an env map they read as black. We use moderate metalness + higher
// roughness so the diffuse colour still carries the surface, mimicking
// brushed stainless steel without depending on an HDR env. Revisit when we
// add a scene environment map.
export function getSteelMaterial(): MeshStandardMaterial {
  if (!steelMat) {
    steelMat = new MeshStandardMaterial({
      color: STEEL_COLOR,
      metalness: 0.6,
      roughness: 0.45,
    });
  }
  return steelMat;
}

export function getEngineMaterial(): MeshStandardMaterial {
  if (!engineMat) {
    engineMat = new MeshStandardMaterial({
      color: ENGINE_COLOR,
      metalness: 0.4,
      roughness: 0.6,
    });
  }
  return engineMat;
}

export function getFinMaterial(): MeshStandardMaterial {
  if (!finMat) {
    finMat = new MeshStandardMaterial({
      color: FIN_COLOR,
      metalness: 0.55,
      roughness: 0.5,
    });
  }
  return finMat;
}
