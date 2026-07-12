/**
 * Baked-terrain heightfield decoding (SLS-57, ADR-018).
 *
 * The bake (`tools/assets/bake-terrain.mjs`) writes heightmaps as 8-bit RGB
 * PNGs with the 16-bit height value split across channels (R = high byte,
 * G = low byte) because browser canvases can only read 8 bits per channel.
 * Height formula: v = R*256 + G; h_m = minM + (v / 65535) * rangeM.
 */

export interface Heightfield {
  /** samples per side */
  px: number;
  /** heights in metres, row-major, row 0 = north edge, col 0 = west edge */
  heights: Float32Array;
}

export async function loadHeightfield(
  url: string,
  minM: number,
  rangeM: number,
): Promise<Heightfield> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`heightfield fetch failed: ${res.status} ${url}`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob, {
    // exact pixel values — no colour management, no alpha premultiply
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  const px = bmp.width; // capture BEFORE close() — a closed bitmap reports 0
  if (bmp.height !== px) {
    throw new Error(`heightmap must be square, got ${px}x${bmp.height}: ${url}`);
  }
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d canvas context unavailable");
  ctx.drawImage(bmp, 0, 0);
  const { data } = ctx.getImageData(0, 0, px, bmp.height);
  bmp.close();
  const heights = new Float32Array(px * px);
  for (let i = 0; i < heights.length; i++) {
    const v = data[i * 4] * 256 + data[i * 4 + 1];
    heights[i] = minM + (v / 65535) * rangeM;
  }
  return { px, heights };
}
