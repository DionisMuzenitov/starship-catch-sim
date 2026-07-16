/**
 * SLS-76 launch-tower asset pipeline (headless — no Blender).
 *
 * Assembles a community CC-BY *print kit* (dozens of STL parts, each centred
 * at its own print origin) into a single real-time GLB the web app ships,
 * replacing the procedural `MechazillaTower.tsx`.
 *
 * Why a bespoke tool (vs SLS-44's `build-glb.mjs`): that pipeline consumes an
 * already-assembled glTF. A print kit is NOT assembled — every segment sits at
 * z=0 on its own print bed. So this tool: (1) parses each binary STL, (2) places
 * instances per a data-driven LAYOUT (stack Base + N×Main + Top, arms, pad),
 * (3) rotates the Z-up mm assembly into the sim's Y-up metres and scales it to
 * `TOWER_HEIGHT_M`, then (4) welds + simplifies + Draco-compresses.
 *
 * The two chopstick arms are emitted as NAMED nodes ("LeftChopstick",
 * "RightChopstick") whose origin is the hinge, so the scene loader can rotate
 * them for the open/close animation (same articulation contract as ADR-012).
 *
 * Source STLs are NOT committed (CC-BY, downloaded per ASSETS.md). Point
 * --kit at the extracted kit root (the dir containing the STL subfolders).
 *
 * Usage:
 *   node tools/assets/build-tower-glb.mjs \
 *     --kit <path/to/extracted/kit> --layout mikenotbrick \
 *     [--out apps/web/public/assets/mechazilla-tower.glb] [--ratio 0.5] [--raw]
 *
 *   --raw   skip simplify+Draco (fast iteration; larger file)
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { Document, NodeIO } from "@gltf-transform/core";
import { KHRDracoMeshCompression } from "@gltf-transform/extensions";
import { dedup, prune, simplify, weld } from "@gltf-transform/functions";
import draco3d from "draco3d";
import { MeshoptSimplifier } from "meshoptimizer";

import { TOWER_HEIGHT_M } from "../../packages/physics/src/index.js";

import { LAYOUTS } from "./tower-layouts.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

const kitDir = arg("kit");
const layoutName = arg("layout");
const outPath = arg("out", "apps/web/public/assets/mechazilla-tower.glb");
const ratio = Number(arg("ratio", "0.5"));
const raw = Boolean(arg("raw", false));
const plan = Boolean(arg("plan", false)); // ASCII plan/side views for headless checking

// world-space debug points: [x, y(up), z, tag] — tag t=tower, a=arm, c=carriage
const planPts = [];
function collectPlanPts(worldPos, tag, translate = [0, 0, 0]) {
  if (!plan) return;
  for (let i = 0; i < worldPos.length; i += 30) {
    planPts.push([
      worldPos[i] + translate[0],
      worldPos[i + 1] + translate[1],
      worldPos[i + 2] + translate[2],
      tag,
    ]);
  }
}

if (!kitDir || !layoutName) {
  console.error("--kit <dir> and --layout <name> are required");
  process.exit(1);
}
const layout = LAYOUTS[layoutName];
if (!layout) {
  console.error(`unknown layout "${layoutName}" (have: ${Object.keys(LAYOUTS).join(", ")})`);
  process.exit(1);
}

/* ---- binary STL parser: returns flat face-normal geometry (mm) --------- */
function parseStl(path) {
  const buf = readFileSync(path);
  const n = buf.readUInt32LE(80);
  // sanity: file size must match a binary STL of n triangles
  if (buf.length < 84 + n * 50) {
    throw new Error(`${basename(path)}: not a binary STL (or truncated)`);
  }
  const positions = new Float32Array(n * 9);
  const normals = new Float32Array(n * 9);
  let o = 84;
  for (let t = 0; t < n; t++) {
    const nx = buf.readFloatLE(o), ny = buf.readFloatLE(o + 4), nz = buf.readFloatLE(o + 8);
    o += 12;
    for (let v = 0; v < 3; v++) {
      const p = t * 9 + v * 3;
      positions[p] = buf.readFloatLE(o);
      positions[p + 1] = buf.readFloatLE(o + 4);
      positions[p + 2] = buf.readFloatLE(o + 8);
      normals[p] = nx; normals[p + 1] = ny; normals[p + 2] = nz;
      o += 12;
    }
    o += 2; // attribute byte count
  }
  return { positions, normals };
}

/* ---- tiny 3-vector / transform helpers -------------------------------- */
const deg = (d) => (d * Math.PI) / 180;
function rotateEuler([x, y, z], [rx, ry, rz]) {
  // apply Rz * Ry * Rx (degrees) — intrinsic, order X then Y then Z
  let a = x, b = y, c = z, s, co, t1, t2;
  if (rx) { s = Math.sin(deg(rx)); co = Math.cos(deg(rx)); t1 = b * co - c * s; t2 = b * s + c * co; b = t1; c = t2; }
  if (ry) { s = Math.sin(deg(ry)); co = Math.cos(deg(ry)); t1 = a * co + c * s; t2 = -a * s + c * co; a = t1; c = t2; }
  if (rz) { s = Math.sin(deg(rz)); co = Math.cos(deg(rz)); t1 = a * co - b * s; t2 = a * s + b * co; a = t1; b = t2; }
  return [a, b, c];
}

/* Transform a whole vertex buffer in place given a placement, staying in the
 * Z-up mm assembly frame. (Global Z-up→Y-up + fit is applied later, once.) */
function placeInAssembly(src, { rotate = [0, 0, 0], translate = [0, 0, 0] }) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const [x, y, z] = rotateEuler([src[i], src[i + 1], src[i + 2]], rotate);
    out[i] = x + translate[0];
    out[i + 1] = y + translate[1];
    out[i + 2] = z + translate[2];
  }
  return out;
}
function rotateNormals(src, rotate) {
  if (!rotate[0] && !rotate[1] && !rotate[2]) return src;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const [x, y, z] = rotateEuler([src[i], src[i + 1], src[i + 2]], rotate);
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
  }
  return out;
}

/* ---- assemble --------------------------------------------------------- */
const stlCache = new Map();
function loadStl(file) {
  if (!stlCache.has(file)) stlCache.set(file, parseStl(`${kitDir}/${file}`));
  return stlCache.get(file);
}

// Gather every placed instance in the Z-up mm assembly frame first, so we can
// measure the assembled bbox and derive the global fit before writing glTF.
const instances = []; // { name, node, positions, normals }
const bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
function grow(p) {
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k];
      if (v < bbox.min[k]) bbox.min[k] = v;
      if (v > bbox.max[k]) bbox.max[k] = v;
    }
  }
}

for (const part of layout.parts) {
  const src = loadStl(part.file);
  const count = part.count ?? 1;
  for (let c = 0; c < count; c++) {
    const translate = [...(part.translate ?? [0, 0, 0])];
    if (part.pitch) for (let k = 0; k < 3; k++) translate[k] += part.pitch[k] * c;
    const positions = placeInAssembly(src.positions, { rotate: part.rotate, translate });
    const normals = rotateNormals(src.normals, part.rotate ?? [0, 0, 0]);
    grow(positions);
    instances.push({
      name: count > 1 ? `${part.node}_${c}` : part.node,
      node: part.node,
      articulated: part.articulated ?? false,
      positions,
      normals,
    });
  }
}

console.log(
  `assembled ${instances.length} instances; assembly bbox (mm) ` +
    `X[${bbox.min[0].toFixed(0)}..${bbox.max[0].toFixed(0)}] ` +
    `Y[${bbox.min[1].toFixed(0)}..${bbox.max[1].toFixed(0)}] ` +
    `Z[${bbox.min[2].toFixed(0)}..${bbox.max[2].toFixed(0)}]`,
);

// Global fit: Z-up mm → Y-up metres, tower height → TOWER_HEIGHT_M, base at y=0.
const assemblyHeightMm = bbox.max[2] - bbox.min[2];
const targetHeightM = TOWER_HEIGHT_M * (layout.heightFraction ?? 1);
const scale = targetHeightM / assemblyHeightMm; // mm(assembly) → m(world)
const baseZ = bbox.min[2];
// centre X/Y of the tower column on the world origin
const cx = (bbox.min[0] + bbox.max[0]) / 2 + (layout.centreOffsetMm?.[0] ?? 0);
const cy = (bbox.min[1] + bbox.max[1]) / 2 + (layout.centreOffsetMm?.[1] ?? 0);

/* Z-up mm assembly → Y-up metre world. (x,y,z)_zup → (x, z, -y), scaled. */
function toWorld(src) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = (src[i] - cx) * scale;
    const y = (src[i + 1] - cy) * scale;
    const z = (src[i + 2] - baseZ) * scale;
    out[i] = x;      // east
    out[i + 1] = z;  // up
    out[i + 2] = -y; // south
  }
  return out;
}
function normalsToWorld(src) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    out[i] = src[i];
    out[i + 1] = src[i + 2];
    out[i + 2] = -src[i + 1];
  }
  return out;
}

console.log(
  `fit: assembly height ${(assemblyHeightMm / 1000).toFixed(3)} m → ${targetHeightM.toFixed(1)} m ` +
    `(scale ×${scale.toFixed(2)}, ~1:${(1 / scale).toFixed(0)})`,
);

/* ---- build the glTF document ------------------------------------------ */
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene("MechazillaTower");

const metal = doc
  .createMaterial("tower-steel")
  .setBaseColorFactor([0.42, 0.44, 0.47, 1])
  .setMetallicFactor(0.85)
  .setRoughnessFactor(0.55);

// merge non-articulated static instances into one mesh (fewer draw calls);
// keep each articulated arm as its own named node.
const staticPrim = { pos: [], nrm: [] };
const articulatedNodes = [];

for (const inst of instances) {
  const wp = toWorld(inst.positions);
  const wn = normalsToWorld(inst.normals);
  collectPlanPts(wp, "t");
  if (inst.articulated) {
    const pos = doc.createAccessor().setType("VEC3").setArray(wp).setBuffer(buffer);
    const nrm = doc.createAccessor().setType("VEC3").setArray(wn).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute("POSITION", pos).setAttribute("NORMAL", nrm).setMaterial(metal);
    const mesh = doc.createMesh(inst.name).addPrimitive(prim);
    articulatedNodes.push(doc.createNode(inst.name).setMesh(mesh));
  } else {
    staticPrim.pos.push(wp);
    staticPrim.nrm.push(wn);
  }
}

// concat static geometry
const totalLen = staticPrim.pos.reduce((a, p) => a + p.length, 0);
const allPos = new Float32Array(totalLen);
const allNrm = new Float32Array(totalLen);
let off = 0;
for (let i = 0; i < staticPrim.pos.length; i++) {
  allPos.set(staticPrim.pos[i], off);
  allNrm.set(staticPrim.nrm[i], off);
  off += staticPrim.pos[i].length;
}
const sPos = doc.createAccessor().setType("VEC3").setArray(allPos).setBuffer(buffer);
const sNrm = doc.createAccessor().setType("VEC3").setArray(allNrm).setBuffer(buffer);
const sPrim = doc.createPrimitive().setAttribute("POSITION", sPos).setAttribute("NORMAL", sNrm).setMaterial(metal);
const sMesh = doc.createMesh("TowerStatic").addPrimitive(sPrim);
scene.addChild(doc.createNode("TowerStatic").setMesh(sMesh));
for (const n of articulatedNodes) scene.addChild(n);

/* ---- chopstick arms: world-space, physics-anchored, articulated ------- */
// Placed directly in world metres at the physics hinges (not the assembly
// frame), so the visual arms pivot where the catch geometry expects. Each is
// its own named node (origin = hinge) so the loader rotates it for open/close.
for (const arm of layout.worldArms ?? []) {
  const src = loadStl(arm.file);
  const S = scale * (arm.scaleMul ?? 1);
  const [xPin, yPin] = arm.pivotNative ?? [0, 0];
  const [xAnc, yAnc] = arm.anchorNative ?? [xPin, yPin];
  for (const side of arm.sides) {
    // native (x,y,z): tip at y=0, vertical pivot pin at (xPin, yPin), +z up.
    // Mount = 180° about the pin's vertical axis so the tip points +X (east,
    // toward the rocket) and the tail/skid tucks back along the tower:
    //   localX = (yPin − y)·S,  localY = (z − vertZero)·S,  localZ = (xPin − x)·S
    // side.mirror flips Z (mirror-image arm) — an improper transform, so the
    // triangle winding is reversed below to keep faces outward.
    const m = side.mirror ? -1 : 1;
    const local = new Float32Array(src.positions.length);
    const lnrm = new Float32Array(src.normals.length);
    for (let i = 0; i < local.length; i += 3) {
      const x = src.positions[i];
      const y = src.positions[i + 1];
      const z = src.positions[i + 2];
      local[i] = (yPin - y) * S; // +X, toward the rocket/sea
      local[i + 1] = (z - (arm.vertZeroNative ?? 0)) * S; // +Y up
      local[i + 2] = m * (xPin - x) * S; // ±Z width
      lnrm[i] = -src.normals[i + 1];
      lnrm[i + 1] = src.normals[i + 2];
      lnrm[i + 2] = m * -src.normals[i];
    }
    if (side.mirror) {
      // reverse winding: swap vertices 2 and 3 of every triangle
      for (let t = 0; t < local.length; t += 9) {
        for (let k = 0; k < 3; k++) {
          const a = local[t + 3 + k];
          local[t + 3 + k] = local[t + 6 + k];
          local[t + 6 + k] = a;
          const b = lnrm[t + 3 + k];
          lnrm[t + 3 + k] = lnrm[t + 6 + k];
          lnrm[t + 6 + k] = b;
        }
      }
    }
    // Node origin = the pivot tube's world position when the ANCHOR point
    // sits at the physics hinge: hinge + R(pivot − anchor). Keeps the
    // owner-approved arm placement while rotating about the real hinge tube.
    const tX = -(yPin - yAnc) * S;
    const tZ = m * (xAnc - xPin) * S;
    const nodeT = [arm.hinge[0] + tX, arm.hinge[1], side.sign * arm.hinge[2] + tZ];
    collectPlanPts(local, "a", nodeT);
    const pos = doc.createAccessor().setType("VEC3").setArray(local).setBuffer(buffer);
    const nrm = doc.createAccessor().setType("VEC3").setArray(lnrm).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute("POSITION", pos).setAttribute("NORMAL", nrm).setMaterial(metal);
    const mesh = doc.createMesh(side.name).addPrimitive(prim);
    scene.addChild(doc.createNode(side.name).setMesh(mesh).setTranslation(nodeT));
  }
}

/* ---- carriage: static frame clamping the arms to the tower ------------- */
// Emitted as a "Carriage" node (origin = tower axis at arm height) so the
// scene lifts it into the arm group (moves with the chopstick assembly).
if (layout.carriage) {
  const parts = [];
  const X0 = layout.carriage.frontPlateXM; // world X of the native x=0 plate
  const zPin = layout.carriage.zPinNative ?? 0;
  for (const { file, xOff = 0 } of layout.carriage.files) {
    const src = loadStl(file);
    const pos = new Float32Array(src.positions.length);
    const nrm = new Float32Array(src.normals.length);
    for (let i = 0; i < pos.length; i += 3) {
      // native (x,y,z): +x = depth back over the tower, y = width, +z = up
      // → world-local: X = X0 − depth (plate flush on the east face, boom
      //   reaching west), Y = (z − zPin) up, Z = width. Proper rotation.
      pos[i] = X0 - (src.positions[i] + xOff) * scale;
      pos[i + 1] = (src.positions[i + 2] - zPin) * scale;
      pos[i + 2] = src.positions[i + 1] * scale;
      nrm[i] = -src.normals[i];
      nrm[i + 1] = src.normals[i + 2];
      nrm[i + 2] = src.normals[i + 1];
    }
    parts.push({ pos, nrm });
  }
  const len = parts.reduce((a, p) => a + p.pos.length, 0);
  const cp = new Float32Array(len);
  const cn = new Float32Array(len);
  let o = 0;
  for (const p of parts) {
    cp.set(p.pos, o);
    cn.set(p.nrm, o);
    o += p.pos.length;
  }
  const cpos = doc.createAccessor().setType("VEC3").setArray(cp).setBuffer(buffer);
  const cnrm = doc.createAccessor().setType("VEC3").setArray(cn).setBuffer(buffer);
  const cprim = doc.createPrimitive().setAttribute("POSITION", cpos).setAttribute("NORMAL", cnrm).setMaterial(metal);
  const cmesh = doc.createMesh("Carriage").addPrimitive(cprim);
  collectPlanPts(cp, "c", [0, layout.carriage.heightM, 0]);
  scene.addChild(doc.createNode("Carriage").setMesh(cmesh).setTranslation([0, layout.carriage.heightM, 0]));
}

/* ---- --plan: ASCII views to sanity-check assembly without a browser ---- */
if (plan) {
  const view = (title, hAxis, vAxis, hRange, vRange, flipV) => {
    const W = 100, H = 44;
    const grid = Array.from({ length: H }, () => new Array(W).fill("."));
    const rank = { t: 1, c: 2, a: 3 }; // arms/carriage draw over tower
    const chr = { t: "·", c: "O", a: "#" };
    for (const p of planPts) {
      const h = p[hAxis], v = p[vAxis];
      if (h < hRange[0] || h > hRange[1] || v < vRange[0] || v > vRange[1]) continue;
      const ci = Math.min(W - 1, Math.floor(((h - hRange[0]) / (hRange[1] - hRange[0])) * W));
      let ri = Math.min(H - 1, Math.floor(((v - vRange[0]) / (vRange[1] - vRange[0])) * H));
      if (flipV) ri = H - 1 - ri;
      const cur = grid[ri][ci];
      const curRank = cur === "." ? 0 : rank[Object.keys(chr).find((k) => chr[k] === cur)];
      if (rank[p[3]] >= curRank) grid[ri][ci] = chr[p[3]];
    }
    console.log(`\n${title}`);
    for (const row of grid) console.log(row.join(""));
  };
  // top-down: east → right, south → down (tower centre at origin)
  view("PLAN (top-down)  x east→  z south↓   [·=tower  O=carriage  #=arm]", 0, 2, [-25, 45], [-22, 22], false);
  // side: east → right, up ↑ — zoomed on the carriage/arm band
  view("SIDE (from south) x east→  y up↑   zoom y 70..105", 0, 1, [-25, 45], [70, 105], true);
}

function countTris(d) {
  let t = 0;
  for (const m of d.getRoot().listMeshes())
    for (const pr of m.listPrimitives()) {
      const idx = pr.getIndices();
      const pos = pr.getAttribute("POSITION");
      t += (idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3;
    }
  return Math.round(t);
}
console.log(`raw triangles: ${countTris(doc).toLocaleString()}`);

/* ---- optimise + write ------------------------------------------------- */
await doc.transform(weld({ tolerance: 0.0001 }), dedup(), prune());
if (!raw) {
  MeshoptSimplifier.useExperimentalFeatures = true;
  await MeshoptSimplifier.ready;
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.001 }));
  console.log(`simplified triangles: ${countTris(doc).toLocaleString()} (ratio ${ratio})`);
}

const io = new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({
  "draco3d.encoder": await draco3d.createEncoderModule(),
});
if (!raw) {
  doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({ method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER });
}
await io.write(outPath, doc);
console.log(`wrote ${outPath}`);
