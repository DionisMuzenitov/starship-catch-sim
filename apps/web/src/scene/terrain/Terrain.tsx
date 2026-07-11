/**
 * Baked launch-site terrain (SLS-57, ADR-018): a nested resolution pyramid of
 * heightfield meshes draped with public-domain aerial/satellite imagery,
 * replacing the flat placeholder grid. Assets are produced by
 * `tools/assets/bake-terrain.mjs` (`pnpm bake:terrain`) and committed under
 * `apps/web/public/assets/terrain/`.
 *
 * Levels (see terrain/constants.ts): 1.28 km @ ~0.63 m/px (NAIP-native, the
 * catch site) → 5.12 km → 10.24 km → 102.4 km, each stacked slightly above
 * the coarser one below. Earth curvature is applied to vertex heights
 * (drop = d²/2R) so the horizon reads correctly from high altitude.
 *
 * Drape variants (owner assessment, ADR-018 §2), `?drape=`:
 *   a — USDA NAIP / USGS imagery (public domain, sharp, pre-buildout vintage)
 *   b — Sentinel-2 2024-11-21 (catch-era layout, 10 m, near+wide levels only)
 *   h — hybrid (default): sharp NAIP inner levels + catch-era Sentinel wide
 *
 * Every failure path (software GL, heightfield fetch/decode failure, drape
 * texture failure) falls back to the zero-network placeholder <Ground/> —
 * the environment is decoration and must never take the sim down with it.
 */
import { Component, type ReactNode, Suspense, useEffect, useMemo, useState } from "react";

import { useTexture } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  SRGBColorSpace,
  type Texture,
  type WebGLRenderer,
} from "three";

import { Ground } from "../Ground";

import {
  type DrapeSource,
  HEIGHT_MIN_M,
  HEIGHT_RANGE_M,
  TERRAIN_LEVELS,
  type TerrainLevel,
} from "./constants";
import { type Heightfield, loadHeightfield } from "./heightfield";

const EARTH_RADIUS_M = 6_371_000;

const TERRAIN_BASE = `${import.meta.env.BASE_URL}assets/terrain/`;

type Variant = "a" | "b" | "h";

/** Drape variant for the ADR-018 owner A/B — default is the hybrid. */
function drapeVariant(): Variant {
  if (typeof window === "undefined") return "h";
  const v = new URLSearchParams(window.location.search).get("drape");
  return v === "a" || v === "b" ? v : "h";
}

/** `?terrain=force` renders terrain even on software GL; `?terrain=off` never. */
function terrainMode(): "auto" | "force" | "off" {
  if (typeof window === "undefined") return "auto";
  const v = new URLSearchParams(window.location.search).get("terrain");
  return v === "force" || v === "off" ? v : "auto";
}

/** The levels a variant renders, with the drape source each level uses. */
function levelsFor(variant: Variant): Array<{ level: TerrainLevel; source: DrapeSource }> {
  return TERRAIN_LEVELS.flatMap((level) => {
    if (variant === "h") {
      // hybrid: catch-era Sentinel wide field, sharp NAIP everywhere else
      const source: DrapeSource = level.key === "wide" ? "b" : "a";
      return [{ level, source }];
    }
    if (!level.variants.includes(variant)) return [];
    return [{ level, source: variant }];
  });
}

/**
 * Software rasterisers (headless CI's SwiftShader, GPU-blocklisted browsers)
 * can't hold frame rate with the draped terrain — they keep the lightweight
 * grid instead. Real GPUs render the full environment.
 *
 * Automated contexts (`navigator.webdriver`) also default to the light scene
 * so cross-browser test runs stay deterministic — Firefox hides
 * WEBGL_debug_renderer_info, which would otherwise make the gate fail open
 * there under software GL. `?terrain=force` overrides for the e2e that
 * exercises the terrain path.
 */
function isSoftwareRenderer(gl: WebGLRenderer): boolean {
  if (typeof navigator !== "undefined" && navigator.webdriver) return true;
  const ctx = gl.getContext();
  const info = ctx.getExtension("WEBGL_debug_renderer_info");
  const renderer = info
    ? String(ctx.getParameter(info.UNMASKED_RENDERER_WEBGL))
    : "";
  return /swiftshader|llvmpipe|software|basic render/i.test(renderer);
}

type HeightfieldState = Heightfield | "loading" | "error";

function useHeightfield(url: string): HeightfieldState {
  const [state, setState] = useState<HeightfieldState>("loading");
  useEffect(() => {
    let live = true;
    loadHeightfield(url, HEIGHT_MIN_M, HEIGHT_RANGE_M)
      .then((loaded) => {
        if (live) setState(loaded);
      })
      .catch((err) => {
        console.error("terrain heightfield failed to load", err);
        if (live) setState("error");
      });
    return () => {
      live = false;
    };
  }, [url]);
  return state;
}

/**
 * Build a terrain level geometry from a heightfield: a size×size grid centred
 * on the tower origin, +X east / +Z south (heightmap row 0 = north = -Z),
 * with earth-curvature drop applied. Heights are already relative to the
 * tower-base datum (bake-terrain.mjs), so terrain y=0 = world origin.
 */
function buildLevelGeometry(hf: Heightfield, sizeM: number): BufferGeometry {
  const n = hf.px;
  const positions = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++) {
    // row 0 = north edge → most negative z
    const z = (j / (n - 1) - 0.5) * sizeM;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1) - 0.5) * sizeM;
      const drop = (x * x + z * z) / (2 * EARTH_RADIUS_M);
      const o = (j * n + i) * 3;
      positions[o] = x;
      positions[o + 1] = hf.heights[j * n + i] - drop;
      positions[o + 2] = z;
      const u = (j * n + i) * 2;
      uvs[u] = i / (n - 1);
      // three.js UV origin is bottom-left; image row 0 (north) must map to v=1
      uvs[u + 1] = 1 - j / (n - 1);
    }
  }
  const index = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      index[k++] = a;
      index[k++] = c;
      index[k++] = b;
      index[k++] = b;
      index[k++] = c;
      index[k++] = d;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("uv", new BufferAttribute(uvs, 2));
  geo.setIndex(new BufferAttribute(index, 1));
  geo.computeVertexNormals();
  return geo;
}

function TerrainLevelMesh({
  hf,
  sizeM,
  drape,
  yOffset,
  receiveShadow = false,
}: {
  hf: Heightfield;
  sizeM: number;
  drape: Texture;
  yOffset: number;
  receiveShadow?: boolean;
}) {
  const geometry = useMemo(() => buildLevelGeometry(hf, sizeM), [hf, sizeM]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      geometry={geometry}
      position={[0, yOffset, 0]}
      receiveShadow={receiveShadow}
    >
      <meshStandardMaterial map={drape} roughness={0.92} metalness={0.0} />
    </mesh>
  );
}

/** Suspends on the drape textures — mounted only once heightfields are in. */
function TerrainLevels({
  levels,
  heightfields,
}: {
  levels: Array<{ level: TerrainLevel; source: DrapeSource }>;
  heightfields: Record<string, Heightfield>;
}) {
  const drapes = useTexture(
    levels.map(({ level, source }) => `${TERRAIN_BASE}${level.key}.drape.${source}.jpg`),
  );

  useEffect(() => {
    for (const tex of drapes) {
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
    }
  }, [drapes]);

  const innermost = levels[levels.length - 1]?.level.key;
  return (
    <group>
      {levels.map(({ level }, i) => (
        <TerrainLevelMesh
          key={level.key}
          hf={heightfields[level.key]}
          sizeM={level.sizeM}
          drape={drapes[i]}
          yOffset={level.yOffsetM}
          receiveShadow={level.key === innermost}
        />
      ))}
    </group>
  );
}

/** Heightfields load here — above the texture Suspense — so they download in
 *  parallel with the drapes and every failure path can render <Ground/>. */
function TerrainLoader() {
  const variant = useMemo(drapeVariant, []);
  // one hook per pyramid level (fixed count), regardless of variant
  const states: Record<string, HeightfieldState> = {
    wide: useHeightfield(`${TERRAIN_BASE}wide.height.png`),
    near: useHeightfield(`${TERRAIN_BASE}near.height.png`),
    l1: useHeightfield(`${TERRAIN_BASE}l1.height.png`),
    l0: useHeightfield(`${TERRAIN_BASE}l0.height.png`),
  };
  const levels = useMemo(() => levelsFor(variant), [variant]);

  if (levels.some(({ level }) => typeof states[level.key] === "string")) {
    // still loading, or failed — either way the placeholder grid stands in
    return <Ground />;
  }
  const heightfields = Object.fromEntries(
    levels.map(({ level }) => [level.key, states[level.key] as Heightfield]),
  );
  return (
    <Suspense fallback={<Ground />}>
      <TerrainLevels levels={levels} heightfields={heightfields} />
    </Suspense>
  );
}

/** Error boundary so a failed drape fetch (useTexture throws on rejection)
 *  degrades to the placeholder grid instead of unmounting the app root —
 *  same containment pattern as the GLB vehicle's error boundary. */
class TerrainErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(err: unknown): void {
    console.error("terrain failed to load — falling back to grid", err);
  }

  render(): ReactNode {
    return this.state.failed ? <Ground /> : this.props.children;
  }
}

/** Drop-in replacement for the placeholder <Ground/>: shows the grid until
 *  the baked terrain finishes loading (or indefinitely on software GL). */
export function Terrain() {
  const gl = useThree((s) => s.gl);
  const mode = useMemo(terrainMode, []);
  const software = useMemo(() => isSoftwareRenderer(gl), [gl]);
  if (mode === "off" || (software && mode !== "force")) return <Ground />;
  return (
    <TerrainErrorBoundary>
      <TerrainLoader />
    </TerrainErrorBoundary>
  );
}
