/**
 * Terrain bake for the launch-site environment (SLS-57, ADR-018).
 *
 * Bakes the committed terrain assets from keyless public sources:
 *
 *   apps/web/public/assets/terrain/
 *     near.height.png    16-bit grayscale heightmap, near tier (10.24 km)
 *     wide.height.png    16-bit heightmap, wide tier (102.4 km)
 *     near.drape.a.jpg   variant A near drape (USDA NAIP WMS, ~60 cm class,
 *                        pre-catch-era vintage, US public domain)
 *     wide.drape.a.jpg   variant A wide drape (same source; Mexico/ocean
 *                        nodata filled procedurally)
 *     near.drape.b.jpg   variant B near drape (Sentinel-2 TCI 2024-11-21 —
 *                        catch-era site layout, 10 m; ESA licence — ADR-005
 *                        exception required if this variant ships)
 *     wide.drape.b.jpg   variant B wide drape (same scene, seamless Mexico)
 *     manifest.json      georeference + encoding + provenance per asset
 *
 * The two drape variants exist for the owner A/B decided in SLS-56: sharper
 * but stale-vintage public-domain NAIP vs coarser but catch-era Sentinel-2.
 * Sources and licence analysis: docs/reference/launch-site-sourcing.md.
 *
 * Frame convention (must match apps/web terrain components): world origin =
 * Pad A tower base, +X = east, +Z = south (north is -Z), +Y = up, metres.
 * Images are baked north-up: row 0 = north edge, col 0 = west edge.
 *
 *   node tools/assets/bake-terrain.mjs [--out apps/web/public/assets/terrain] [--skip-b]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fromArrayBuffer, fromUrl } from "geotiff";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../..");

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  if (i < 0) return fallback;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return v;
}
const outArg = argValue("--out", "apps/web/public/assets/terrain");
const outDir = isAbsolute(outArg) ? outArg : join(repo, outArg);
const skipB = args.includes("--skip-b");

// --- site georeference (docs/reference/starbase-site.md) ---
const TOWER_LAT = 25.99613;
const TOWER_LON = -97.15474;
// metres per degree at 26 N
const M_PER_DEG_LAT = 110_922;
const M_PER_DEG_LON = 100_120;

// --- levels (nested resolution pyramid, sharpest at the catch site) ---
// drapeApx is chosen so each level samples the PD source at (or near) its
// native resolution: l0 hits ~0.63 m/px — NAIP-native — where the terminal
// phase and the catch happen. drapeBpx (Sentinel-2, 10 m source) only exists
// where it adds information.
const TIERS = {
  l0: { sizeM: 1_280, demPx: 64, drapeApx: 2048 },
  l1: { sizeM: 5_120, demPx: 128, drapeApx: 4096 },
  near: { sizeM: 10_240, demPx: 256, drapeApx: 4096, drapeBpx: 1024 },
  wide: { sizeM: 102_400, demPx: 256, drapeApx: 2048, drapeBpx: 2048 },
};

// Height encoding for the 16-bit PNGs: h_m = min + (v / 65535) * range.
const HEIGHT_MIN_M = -16;
const HEIGHT_RANGE_M = 112;

const DEM_WMS = "https://elevation.nationalmap.gov/arcgis/services/3DEPElevation/ImageServer/WMSServer";
// USGS base map — coarser/older, but renders at wide-tier scales.
const IMG_WMS = "https://basemap.nationalmap.gov/arcgis/services/USGSImageryOnly/MapServer/WMSServer";
// Variant A inner levels: NAIP DOQQ COGs via Microsoft Planetary Computer —
// anonymous SAS tokens, US public domain. Year pinned to the newest with
// coverage here (2022-06-10: tower + OLM + tank farm are in the imagery).
const MPC_STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const MPC_SAS = "https://planetarycomputer.microsoft.com/api/sas/v1/token/naip";
const NAIP_YEAR = 2022;
// Variant B: pinned cloud-free (<0.01 %) Sentinel-2 scenes from the catch era
// (between the Flight 5 and Flight 7 catches). Found via earth-search STAC:
// collections=sentinel-2-l2a, bbox around the site, 2024-09..11, cloud<5 %.
// Two same-day tiles: 14RPP holds the site, 14RPQ fills the wide tier's
// northern strip. Later entries win where tiles overlap.
const S2_DATE = "2024-11-21";
const S2_PX_M = 10;
const S2_SHAPE_PX = 10_980;
const S2_SCENES = [
  {
    id: "S2B_14RPQ_20241121_0_L2A",
    tci: "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/14/R/PQ/2024/11/S2B_14RPQ_20241121_0_L2A/TCI.tif",
    originE: 600_000,
    originN: 3_000_000,
  },
  {
    id: "S2B_14RPP_20241121_0_L2A",
    tci: "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/14/R/PP/2024/11/S2B_14RPP_20241121_0_L2A/TCI.tif",
    originE: 600_000,
    originN: 2_900_040,
  },
];

// ---------------------------------------------------------------------------
// geodesy
// ---------------------------------------------------------------------------

function bbox(sizeM) {
  const dLat = sizeM / 2 / M_PER_DEG_LAT;
  const dLon = sizeM / 2 / M_PER_DEG_LON;
  // WMS 1.3.0 CRS:84 order: minLon,minLat,maxLon,maxLat
  return [TOWER_LON - dLon, TOWER_LAT - dLat, TOWER_LON + dLon, TOWER_LAT + dLat];
}

/** WGS84 -> UTM (Krüger series, ~mm accuracy — plenty for 10 m pixels). */
function utmForward(latDeg, lonDeg, zone) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const E0 = 500_000;
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const lon0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;

  const n = f / (2 - f);
  const n2 = n * n;
  const n3 = n2 * n;
  const A = (a / (1 + n)) * (1 + n2 / 4 + (n2 * n2) / 64);
  const alpha = [
    n / 2 - (2 / 3) * n2 + (5 / 16) * n3,
    (13 / 48) * n2 - (3 / 5) * n3,
    (61 / 240) * n3,
  ];
  const t = Math.sinh(
    Math.atanh(Math.sin(lat)) -
      ((2 * Math.sqrt(n)) / (1 + n)) * Math.atanh(((2 * Math.sqrt(n)) / (1 + n)) * Math.sin(lat)),
  );
  const xi = Math.atan2(t, Math.cos(lon - lon0));
  const eta = Math.atanh(Math.sin(lon - lon0) / Math.sqrt(1 + t * t));
  let E = eta;
  let N = xi;
  for (let j = 1; j <= 3; j++) {
    E += alpha[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    N += alpha[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return { easting: E0 + k0 * A * E, northing: k0 * A * N };
}

// ---------------------------------------------------------------------------
// fetch helpers
// ---------------------------------------------------------------------------

function wmsUrl(base, { layers, format, box, w, h }) {
  const p = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: layers,
    STYLES: "",
    CRS: "CRS:84",
    BBOX: box.join(","),
    WIDTH: String(w),
    HEIGHT: String(h),
    FORMAT: format,
  });
  return `${base}?${p}`;
}

async function fetchBuf(url, what, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${what}: HTTP ${res.status} from ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) throw new Error(`${what}: suspiciously small response (${buf.length} B) — likely a WMS error document`);
      return buf;
    } catch (err) {
      if (attempt >= attempts) throw err;
      const waitS = 5 * attempt;
      console.warn(`${what}: attempt ${attempt} failed (${err.message}); retrying in ${waitS}s`);
      await new Promise((r) => setTimeout(r, waitS * 1000));
    }
  }
}

// ---------------------------------------------------------------------------
// nodata fill — sources render no-coverage (open Gulf, Mexico side, beyond a
// mosaic's max scale) as pure white or pure black. Flood-fill such regions
// connected to the image border (interior white like surf foam survives),
// grow colours in from the region edge, then blur the fill so it reads as
// distant haze instead of streaks.
// ---------------------------------------------------------------------------

function fillNodata(px, w, h) {
  // near-white (with JPEG-ringing tolerance: bright and unsaturated) or
  // near-black counts as potential nodata
  const isWhite = (i) => {
    const r = px[i * 4];
    const g = px[i * 4 + 1];
    const b = px[i * 4 + 2];
    const lo = Math.min(r, g, b);
    const hi = Math.max(r, g, b);
    // bright-unsaturated or dark-unsaturated, with JPEG-ringing tolerance
    return (lo >= 236 || hi <= 18) && hi - lo <= 14;
  };
  const nodata = new Uint8Array(w * h);
  const queue = [];
  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) {
      const i = y * w + x;
      if (isWhite(i) && !nodata[i]) { nodata[i] = 1; queue.push(i); }
    }
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, w - 1]) {
      const i = y * w + x;
      if (isWhite(i) && !nodata[i]) { nodata[i] = 1; queue.push(i); }
    }
  }
  // BFS over the white region from the border
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % w;
    const y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!nodata[j] && isWhite(j)) { nodata[j] = 1; queue.push(j); }
    }
  }
  const total = queue.length;
  if (total === 0) return 0;
  // grow colours into the nodata region from its boundary (multi-source BFS)
  const frontier = [];
  for (const i of queue) {
    const x = i % w;
    const y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!nodata[j]) { frontier.push(i); break; }
    }
  }
  const filled = new Uint8Array(nodata); // 1 = still needs colour
  const grow = [];
  for (const i of frontier) {
    const x = i % w;
    const y = (i / w) | 0;
    let r = 0, g = 0, b = 0, c = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!nodata[j]) { r += px[j * 4]; g += px[j * 4 + 1]; b += px[j * 4 + 2]; c++; }
    }
    if (!c) continue;
    px[i * 4] = r / c;
    px[i * 4 + 1] = g / c;
    px[i * 4 + 2] = b / c;
    filled[i] = 0;
    grow.push(i);
  }
  for (let q = 0; q < grow.length; q++) {
    const i = grow[q];
    const x = i % w;
    const y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (filled[j]) {
        px[j * 4] = px[i * 4];
        px[j * 4 + 1] = px[i * 4 + 1];
        px[j * 4 + 2] = px[i * 4 + 2];
        filled[j] = 0;
        grow.push(j);
      }
    }
  }
  // blur the filled region (separable box blur of the whole frame, applied
  // only to filled pixels) so the BFS growth reads as haze, not streaks;
  // large fills (whole Mexico side) need a much wider blur, applied twice
  // (≈ triangular kernel) to kill directional runs
  const bigFill = total / (w * h) > 0.25;
  const radius = Math.max(8, Math.round(w / (bigFill ? 16 : 96)));
  let blurred = boxBlur(px, w, h, radius);
  if (bigFill) blurred = boxBlur(blurred, w, h, radius);
  // very large fills additionally blend toward the mean valid colour, so the
  // synthesized area reads as neutral distance haze rather than a mirror smear
  const mean = [0, 0, 0];
  if (bigFill) {
    let n = 0;
    for (let i = 0; i < w * h; i++) {
      if (nodata[i]) continue;
      mean[0] += px[i * 4]; mean[1] += px[i * 4 + 1]; mean[2] += px[i * 4 + 2];
      n++;
    }
    for (let c = 0; c < 3; c++) mean[c] /= Math.max(1, n);
  }
  for (const i of queue) {
    for (let c = 0; c < 3; c++) {
      px[i * 4 + c] = bigFill ? 0.6 * blurred[i * 4 + c] + 0.4 * mean[c] : blurred[i * 4 + c];
    }
  }
  // deterministic low-amplitude dither so the fill doesn't band
  for (const i of queue) {
    const x = i % w;
    const y = (i / w) | 0;
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    const n = (s - Math.floor(s)) * 6 - 3; // fract(), not %: JS % keeps sign
    for (let c = 0; c < 3; c++) {
      px[i * 4 + c] = Math.max(0, Math.min(255, px[i * 4 + c] + n));
    }
  }
  return total;
}

/** Two-pass separable box blur (RGB only), returns a new buffer. */
function boxBlur(px, w, h, r) {
  const tmp = new Float32Array(w * h * 3);
  const out = new Uint8Array(px.length);
  // horizontal pass
  for (let y = 0; y < h; y++) {
    let sr = 0, sg = 0, sb = 0;
    for (let x = -r; x <= r; x++) {
      const cx = Math.max(0, Math.min(w - 1, x));
      const i = (y * w + cx) * 4;
      sr += px[i]; sg += px[i + 1]; sb += px[i + 2];
    }
    const win = 2 * r + 1;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      tmp[o] = sr / win; tmp[o + 1] = sg / win; tmp[o + 2] = sb / win;
      const xAdd = Math.min(w - 1, x + r + 1);
      const xSub = Math.max(0, x - r);
      const ia = (y * w + xAdd) * 4;
      const is = (y * w + xSub) * 4;
      sr += px[ia] - px[is]; sg += px[ia + 1] - px[is + 1]; sb += px[ia + 2] - px[is + 2];
    }
  }
  // vertical pass
  for (let x = 0; x < w; x++) {
    let sr = 0, sg = 0, sb = 0;
    for (let y = -r; y <= r; y++) {
      const cy = Math.max(0, Math.min(h - 1, y));
      const o = (cy * w + x) * 3;
      sr += tmp[o]; sg += tmp[o + 1]; sb += tmp[o + 2];
    }
    const win = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      out[i] = sr / win; out[i + 1] = sg / win; out[i + 2] = sb / win; out[i + 3] = 255;
      const yAdd = Math.min(h - 1, y + r + 1);
      const ySub = Math.max(0, y - r);
      const oa = (yAdd * w + x) * 3;
      const os = (ySub * w + x) * 3;
      sr += tmp[oa] - tmp[os]; sg += tmp[oa + 1] - tmp[os + 1]; sb += tmp[oa + 2] - tmp[os + 2];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// bakes
// ---------------------------------------------------------------------------

async function fetchDemRaster(tier, { sizeM, demPx }) {
  const url = wmsUrl(DEM_WMS, {
    layers: "3DEPElevation:None",
    format: "image/tiff",
    box: bbox(sizeM),
    w: demPx,
    h: demPx,
  });
  const buf = await fetchBuf(url, `${tier} DEM`);
  const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const image = await tiff.getImage();
  const [raster] = await image.readRasters();
  return raster;
}

/**
 * Encode a DEM raster as the committed heightmap PNG. `datumM` is the DEM
 * elevation at the tower base: heights are stored relative to it so that
 * terrain y=0 coincides with the world origin the tower/OLM/physics ground
 * plane all sit on (the raw DEM is ~+2.3 m ASL at the pad).
 *
 * Split-channel encoding (R = high byte, G = low byte) instead of a 16-bit
 * grayscale PNG: browsers can only read canvas pixels at 8 bits/channel,
 * so this keeps the full 16-bit height precision web-decodable.
 */
function encodeHeight(tier, raster, demPx, datumM) {
  const png = new PNG({ width: demPx, height: demPx });
  let hMin = Infinity;
  let hMax = -Infinity;
  for (let i = 0; i < demPx * demPx; i++) {
    let h = raster[i];
    // nodata (ocean, Mexico side): clamp implausible sentinels to sea level
    if (!Number.isFinite(h) || h < -100 || h > 1000) h = 0;
    h -= datumM;
    hMin = Math.min(hMin, h);
    hMax = Math.max(hMax, h);
    const v = Math.max(0, Math.min(65535, Math.round(((h - HEIGHT_MIN_M) / HEIGHT_RANGE_M) * 65535)));
    png.data[i * 4] = v >> 8;
    png.data[i * 4 + 1] = v & 0xff;
    png.data[i * 4 + 2] = 0;
    png.data[i * 4 + 3] = 255;
  }
  const out = PNG.sync.write(png);
  writeFileSync(join(outDir, `${tier}.height.png`), out);
  console.log(`${tier}.height.png   ${demPx}x${demPx}  h[${hMin.toFixed(1)}, ${hMax.toFixed(1)}] m rel. tower base  ${(out.length / 1024).toFixed(0)} KB`);
  return { hMin, hMax };
}

/**
 * Colour grade for the NAIP-sourced drapes: raw NAIP reads washed-out and
 * hazy next to consumer map imagery. Saturation boost + gentle contrast
 * about mid-grey, applied before JPEG encode.
 */
function gradeColour(px, w, h) {
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const r = px[o];
    const g = px[o + 1];
    const b = px[o + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    for (let c = 0; c < 3; c++) {
      let v = lum + (px[o + c] - lum) * 1.22;
      v = (v - 128) * 1.1 + 128;
      px[o + c] = Math.max(0, Math.min(255, v));
    }
  }
}

/**
 * Open the NAIP DOQQ COGs (pinned NAIP_YEAR) that intersect the largest
 * inner level, via Planetary Computer's anonymous STAC + SAS token.
 */
async function openNaipScenes(sizeM) {
  const tokenRes = await fetch(MPC_SAS);
  if (!tokenRes.ok) throw new Error(`MPC SAS token: HTTP ${tokenRes.status}`);
  const { token } = await tokenRes.json();

  const res = await fetch(MPC_STAC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      collections: ["naip"],
      bbox: bbox(sizeM),
      query: { "naip:year": { eq: String(NAIP_YEAR) } },
      limit: 20,
    }),
  });
  if (!res.ok) throw new Error(`MPC STAC search: HTTP ${res.status}`);
  const { features } = await res.json();
  if (!features?.length) throw new Error(`no NAIP ${NAIP_YEAR} items found`);

  const scenes = [];
  for (const f of features) {
    const transform = f.properties["proj:transform"];
    const shape = f.properties["proj:shape"];
    const tci = await fromUrl(`${f.assets.image.href}?${token}`);
    scenes.push({
      id: f.id,
      tci,
      pxM: transform[0],
      originE: transform[2],
      originN: transform[5],
      shapeH: shape[0],
      shapeW: shape[1],
      samples: [0, 1, 2], // NAIP COGs are 4-band RGBN
    });
  }
  console.log(`NAIP ${NAIP_YEAR} via Planetary Computer: ${scenes.length} DOQQs (${scenes.map((s) => s.id).join(", ")})`);
  return scenes;
}

async function bakeDrapeA(tier, { sizeM, drapeApx }, naipScenes) {
  let px;
  let w = drapeApx;
  if (tier === "wide") {
    // NAIP DOQQs don't cover 102 km — the wide tier uses the USGS base map
    const url = wmsUrl(IMG_WMS, {
      layers: "0",
      format: "image/jpeg",
      box: bbox(sizeM),
      w: drapeApx,
      h: drapeApx,
    });
    const buf = await fetchBuf(url, `${tier} drape A`);
    const img = jpeg.decode(buf, { maxMemoryUsageInMB: 1024, formatAsRGBA: true });
    px = img.data;
    w = img.width;
  } else {
    px = await mosaicScenes(naipScenes, sizeM, drapeApx);
  }
  const filledPx = fillNodata(px, w, w);
  gradeColour(px, w, w);
  const enc = jpeg.encode({ data: px, width: w, height: w }, 82);
  writeFileSync(join(outDir, `${tier}.drape.a.jpg`), enc.data);
  console.log(`${tier}.drape.a.jpg  ${w}x${w}  ${(enc.data.length / 1024 / 1024).toFixed(2)} MB  (${((filledPx / (w * w)) * 100).toFixed(0)}% nodata filled)`);
  return enc.data.length;
}

/**
 * Mosaic a list of georeferenced COG scenes (UTM 14N) into an RGBA canvas
 * covering the level's square around the tower. Later scenes win overlaps;
 * near-black source pixels are treated as scene nodata and skipped. Returns
 * the canvas (white = still-uncovered, handled by fillNodata).
 *
 * Each scene: { tci, originE, originN, pxM, shapeW, shapeH, samples? }.
 */
async function mosaicScenes(scenes, sizeM, outPx) {
  const half = sizeM / 2;
  const t = utmForward(TOWER_LAT, TOWER_LON, 14);
  const px = new Uint8Array(outPx * outPx * 4).fill(255);

  for (const scene of scenes) {
    // window in this scene's pixel coords for the level's square
    const x0 = (t.easting - half - scene.originE) / scene.pxM;
    const y0 = (scene.originN - (t.northing + half)) / scene.pxM;
    const x1 = (t.easting + half - scene.originE) / scene.pxM;
    const y1 = (scene.originN - (t.northing - half)) / scene.pxM;
    const cx0 = Math.max(0, Math.round(x0));
    const cy0 = Math.max(0, Math.round(y0));
    const cx1 = Math.min(scene.shapeW, Math.round(x1));
    const cy1 = Math.min(scene.shapeH, Math.round(y1));
    if (cx1 <= cx0 || cy1 <= cy0) continue; // scene doesn't intersect

    // read the clamped window, resampled to its fraction of the output
    const outW = Math.round(((cx1 - cx0) / (x1 - x0)) * outPx);
    const outH = Math.round(((cy1 - cy0) / (y1 - y0)) * outPx);
    const rasters = await scene.tci.readRasters({
      window: [cx0, cy0, cx1, cy1],
      width: outW,
      height: outH,
      interleave: true,
      ...(scene.samples ? { samples: scene.samples } : {}),
    });
    const offX = Math.round(((cx0 - x0) / (x1 - x0)) * outPx);
    const offY = Math.round(((cy0 - y0) / (y1 - y0)) * outPx);
    for (let y = 0; y < outH; y++) {
      const ty = y + offY;
      if (ty < 0 || ty >= outPx) continue;
      for (let x = 0; x < outW; x++) {
        const tx = x + offX;
        if (tx < 0 || tx >= outPx) continue;
        const s = (y * outW + x) * 3;
        // scenes carry black nodata at their edges — don't let one scene's
        // edge stomp a valid pixel from another
        if (rasters[s] < 4 && rasters[s + 1] < 4 && rasters[s + 2] < 4) continue;
        const d = (ty * outPx + tx) * 4;
        px[d] = rasters[s];
        px[d + 1] = rasters[s + 1];
        px[d + 2] = rasters[s + 2];
      }
    }
  }
  return px;
}

async function bakeDrapeB(tier, { sizeM, drapeBpx }, tciList) {
  const scenes = tciList.map(({ scene, tci }) => ({
    tci,
    originE: scene.originE,
    originN: scene.originN,
    pxM: S2_PX_M,
    shapeW: S2_SHAPE_PX,
    shapeH: S2_SHAPE_PX,
  }));
  const px = await mosaicScenes(scenes, sizeM, drapeBpx);
  const filledPx = fillNodata(px, drapeBpx, drapeBpx);
  const enc = jpeg.encode({ data: px, width: drapeBpx, height: drapeBpx }, 85);
  writeFileSync(join(outDir, `${tier}.drape.b.jpg`), enc.data);
  console.log(`${tier}.drape.b.jpg  ${drapeBpx}x${drapeBpx}  ${(enc.data.length / 1024 / 1024).toFixed(2)} MB  (${((filledPx / (drapeBpx * drapeBpx)) * 100).toFixed(0)}% out-of-coverage filled)`);
  return enc.data.length;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const stats = {};
  const tciList = skipB
    ? []
    : await Promise.all(S2_SCENES.map(async (scene) => ({ scene, tci: await fromUrl(scene.tci) })));

  // datum: DEM elevation at the tower base (centre pixel of the near tier),
  // shared by both tiers so their surfaces agree where they overlap
  const rasters = {};
  for (const [tier, cfg] of Object.entries(TIERS)) {
    rasters[tier] = await fetchDemRaster(tier, cfg);
  }
  const nearPx = TIERS.near.demPx;
  const datumM = rasters.near[Math.floor(nearPx / 2) * nearPx + Math.floor(nearPx / 2)];
  console.log(`tower-base datum: ${datumM.toFixed(2)} m ASL (subtracted from all heights)`);

  const naipScenes = await openNaipScenes(TIERS.near.sizeM);

  for (const [tier, cfg] of Object.entries(TIERS)) {
    const { hMin, hMax } = encodeHeight(tier, rasters[tier], cfg.demPx, datumM);
    const aBytes = await bakeDrapeA(tier, cfg, naipScenes);
    // Sentinel-2 is 10 m/px — variant B only exists at levels where that
    // resolution adds information (near/wide), not the sharp inner levels
    const bBytes = skipB || !cfg.drapeBpx ? 0 : await bakeDrapeB(tier, cfg, tciList);
    stats[tier] = { hMin, hMax, aBytes, bBytes };
  }

  const manifest = {
    generated: new Date().toISOString(),
    origin: { lat: TOWER_LAT, lon: TOWER_LON, note: "Pad A tower base = world origin" },
    frame: "+X east, +Z south (north-up images: row 0 = north, col 0 = west), +Y up, metres",
    heightEncoding: {
      minM: HEIGHT_MIN_M,
      rangeM: HEIGHT_RANGE_M,
      datumM,
      formula: "v = R*256 + G; h = minM + (v/65535)*rangeM  (relative to the tower-base datum: h=0 at world origin)",
    },
    tiers: Object.fromEntries(
      Object.entries(TIERS).map(([tier, cfg]) => [
        tier,
        { sizeM: cfg.sizeM, demPx: cfg.demPx, drapeApx: cfg.drapeApx, drapeBpx: cfg.drapeBpx, ...stats[tier] },
      ]),
    ),
    provenance: {
      dem: "USGS 3DEP via 3DEPElevation ImageServer WMS — US public domain; courtesy credit: U.S. Geological Survey",
      drapeA:
        `l0/l1/near levels: USDA NAIP ${NAIP_YEAR} DOQQ COGs via Microsoft Planetary Computer (anonymous SAS; tower/OLM/tank farm visible in the imagery); wide tier: USGS The National Map Imagery-Only base map (NAIP-derived over CONUS). All US public domain; courtesy credit: USDA FSA / U.S. Geological Survey. No-coverage areas (open Gulf / Mexico side) filled procedurally; colour-graded (saturation 1.22, contrast 1.10).`,
      drapeB: `Sentinel-2 L2A true-colour, scenes ${S2_SCENES.map((s) => s.id).join(" + ")} (${S2_DATE}, <0.01 % cloud — catch era). Contains modified Copernicus Sentinel data 2024. ESA licence is permissive but NOT CC — ships only with a recorded ADR-005 exception (owner A/B pending).`,
      policy: "docs/adr/018-launch-site-environment-sourcing.md, docs/reference/launch-site-sourcing.md",
    },
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const totalMB = Object.values(stats).reduce((s, t) => s + t.aBytes + t.bBytes, 0) / 1024 / 1024;
  console.log(`manifest.json written; total drape payload ${totalMB.toFixed(2)} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
