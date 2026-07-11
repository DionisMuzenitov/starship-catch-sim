/**
 * Baked launch-site terrain (SLS-57, ADR-018): two tiers of heightfield mesh
 * draped with public-domain aerial/satellite imagery, replacing the flat
 * placeholder grid. Assets are produced by `tools/assets/bake-terrain.mjs`
 * (`pnpm bake:terrain`) and committed under `apps/web/public/assets/terrain/`.
 *
 *   near tier: 10.24 km around the tower, 4096-px NAIP drape (variant A)
 *   wide tier: 102.4 km, satellite drape, sits 3 m below the near tier
 *
 * Drape variant A/B (owner assessment, ADR-018 §2): `?drape=b` switches to
 * the Sentinel-2 catch-era drape; default is the public-domain NAIP one.
 * Earth curvature is applied to vertex heights (drop = d²/2R) so the wide
 * tier's horizon reads correctly from high altitude.
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

import { HEIGHT_MIN_M, HEIGHT_RANGE_M, NEAR_SIZE_M, WIDE_SIZE_M } from "./constants";
import { type Heightfield, loadHeightfield } from "./heightfield";

/** wide tier sits this far below the near tier to avoid z-fighting */
const WIDE_Y_OFFSET_M = -3;
const EARTH_RADIUS_M = 6_371_000;

const TERRAIN_BASE = `${import.meta.env.BASE_URL}assets/terrain/`;

/** Drape variant for the ADR-018 owner A/B — `?drape=b` selects Sentinel-2. */
function drapeVariant(): "a" | "b" {
  if (typeof window === "undefined") return "a";
  return new URLSearchParams(window.location.search).get("drape") === "b" ? "b" : "a";
}

/** `?terrain=force` renders terrain even on software GL; `?terrain=off` never. */
function terrainMode(): "auto" | "force" | "off" {
  if (typeof window === "undefined") return "auto";
  const v = new URLSearchParams(window.location.search).get("terrain");
  return v === "force" || v === "off" ? v : "auto";
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
 * Build a terrain tier geometry from a heightfield: a size×size grid centred
 * on the tower origin, +X east / +Z south (heightmap row 0 = north = -Z),
 * with earth-curvature drop applied. Heights are already relative to the
 * tower-base datum (bake-terrain.mjs), so terrain y=0 = world origin.
 */
function buildTierGeometry(hf: Heightfield, sizeM: number): BufferGeometry {
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

function TerrainTier({
  hf,
  sizeM,
  drape,
  yOffset = 0,
  receiveShadow = false,
}: {
  hf: Heightfield;
  sizeM: number;
  drape: Texture;
  yOffset?: number;
  receiveShadow?: boolean;
}) {
  const geometry = useMemo(() => buildTierGeometry(hf, sizeM), [hf, sizeM]);
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
function TerrainTiers({
  nearHf,
  wideHf,
  variant,
}: {
  nearHf: Heightfield;
  wideHf: Heightfield;
  variant: "a" | "b";
}) {
  const [nearDrape, wideDrape] = useTexture([
    `${TERRAIN_BASE}near.drape.${variant}.jpg`,
    `${TERRAIN_BASE}wide.drape.${variant}.jpg`,
  ]);

  useEffect(() => {
    for (const tex of [nearDrape, wideDrape]) {
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
    }
  }, [nearDrape, wideDrape]);

  return (
    <group>
      <TerrainTier
        hf={wideHf}
        sizeM={WIDE_SIZE_M}
        drape={wideDrape}
        yOffset={WIDE_Y_OFFSET_M}
      />
      <TerrainTier hf={nearHf} sizeM={NEAR_SIZE_M} drape={nearDrape} receiveShadow />
    </group>
  );
}

/** Heightfields load here — above the texture Suspense — so they download in
 *  parallel with the drapes and every failure path can render <Ground/>. */
function TerrainLoader() {
  const variant = useMemo(drapeVariant, []);
  const nearHf = useHeightfield(`${TERRAIN_BASE}near.height.png`);
  const wideHf = useHeightfield(`${TERRAIN_BASE}wide.height.png`);

  if (typeof nearHf === "string" || typeof wideHf === "string") {
    // still loading, or failed — either way the placeholder grid stands in
    return <Ground />;
  }
  return (
    <Suspense fallback={<Ground />}>
      <TerrainTiers nearHf={nearHf} wideHf={wideHf} variant={variant} />
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
