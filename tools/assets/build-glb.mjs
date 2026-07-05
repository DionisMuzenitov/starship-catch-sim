/**
 * SLS-44 asset pipeline (headless — no Blender).
 *
 * Turns the raw Sketchfab export of clarence365's "SpaceX Starship Ship
 * S25 & Booster 9" (CC-BY-4.0) into a real-time, Draco-compressed GLB the
 * web app ships. The raw model is ~872k triangles / 34 MB — unshippable
 * for a browser demo — so we simplify (meshoptimizer) and Draco-compress.
 *
 * CRITICAL: the scene graph is preserved. The model's articulated parts
 * (4 grid fins, 13 booster Raptors, ship flaps/engines) are separate
 * NAMED nodes carrying a `matrix` that places each part's origin at its
 * mount — the loader rotates those nodes for articulation (ADR-012). So
 * we must NOT flatten/join/weld across nodes in a way that collapses the
 * hierarchy or drops names. `prune` keeps used nodes; `dedup` shares mesh
 * data; `simplify` reduces triangles in place.
 *
 * Source is NOT committed (it's clarence365's model, downloaded from
 * Sketchfab per ASSETS.md). Point --in at the extracted `scene.gltf`.
 *
 * Usage:
 *   node tools/assets/build-glb.mjs --in <path/to/scene.gltf> \
 *     [--out apps/web/public/assets/starship-stack.glb] [--ratio 0.2]
 */

import { NodeIO } from "@gltf-transform/core";
import { KHRDracoMeshCompression } from "@gltf-transform/extensions";
import {
  dedup,
  prune,
  simplify,
  weld,
} from "@gltf-transform/functions";
import draco3d from "draco3d";
import { MeshoptSimplifier } from "meshoptimizer";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const inPath = arg("in");
const outPath = arg("out", "apps/web/public/assets/starship-stack.glb");
const ratio = Number(arg("ratio", "0.2"));
const error = Number(arg("error", "0.002"));

if (!inPath) {
  console.error("--in <scene.gltf> is required");
  process.exit(1);
}

function countTris(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute("POSITION");
      tris += (idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3;
    }
  }
  return Math.round(tris);
}

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    "draco3d.decoder": await draco3d.createDecoderModule(),
    "draco3d.encoder": await draco3d.createEncoderModule(),
  });

await MeshoptSimplifier.ready;

console.log(`reading ${inPath}`);
const doc = await io.read(inPath);
const before = countTris(doc);
const beforeNodes = doc.getRoot().listNodes().length;
console.log(`  triangles: ${before.toLocaleString()} | nodes: ${beforeNodes}`);

console.log(`simplify ratio=${ratio} error=${error} + dedup/weld/prune`);
await doc.transform(
  dedup(),
  // Weld only within a primitive (merge coincident verts) so the meshopt
  // simplifier has a manifold to work on; it does not touch node graph.
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio, error }),
  prune({ keepAttributes: false, keepLeaves: false }),
);

// Draco compression (geometry is the bulk; ~34 MB bin → a few MB).
doc
  .createExtension(KHRDracoMeshCompression)
  .setRequired(true)
  .setEncoderOptions({
    method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
    encodeSpeed: 5,
    decodeSpeed: 5,
  });

const after = countTris(doc);
const afterNodes = doc.getRoot().listNodes().length;
console.log(`  triangles: ${after.toLocaleString()} | nodes: ${afterNodes}`);

// Sanity: the named articulation nodes must survive.
const need = [
  "Superheavy V4_37",
  "Starship V4_19",
  "Gridfin_20",
  "Gridfin.001_21",
  "Gridfin.002_22",
  "Gridfin.003_23",
  "Raptor 2 Engine.003_24",
];
const names = new Set(
  doc
    .getRoot()
    .listNodes()
    .map((n) => n.getName()),
);
const missing = need.filter((n) => !names.has(n));
if (missing.length) {
  console.error(`FATAL: articulation nodes dropped: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`  articulation nodes intact (${need.length} checked)`);

await io.write(outPath, doc);
const { statSync } = await import("node:fs");
console.log(
  `wrote ${outPath} (${(statSync(outPath).size / 1e6).toFixed(2)} MB, ${(
    (100 * after) /
    before
  ).toFixed(0)}% of original tris)`,
);
