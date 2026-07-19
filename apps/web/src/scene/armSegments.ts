/**
 * Chopstick segment-chain collider (SLS-84).
 *
 * A chopstick arm is a long truss beam, not a box, so a single AABB is a poor
 * collision proxy. `segmentChain` slices the arm's real geometry into `n` short
 * bins along its longest axis and bounds each slice with a tight AABB — the
 * chain of boxes traces the beam (taper, hinge section, span). Read in WORLD
 * space (via each mesh's `matrixWorld`), so calling it each frame yields boxes
 * that ride the drawn arm as it opens / rides / yaws. Owner-validated at n=15 in
 * the `/sandbox/arm` lab.
 */
import { Vec3, type Aabb } from "@starship-catch-sim/physics";
import { Vector3, type Mesh, type Object3D } from "three";

const _v = new Vector3();

/** Gather a node's mesh vertices in world space (flat x,y,z triples). */
function worldPoints(node: Object3D): number[] {
  node.updateWorldMatrix(true, true);
  const pts: number[] = [];
  node.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const pos = mesh.geometry.attributes.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      pts.push(_v.x, _v.y, _v.z);
    }
  });
  return pts;
}

/**
 * Slice `node`'s world geometry into `n` tight AABBs along its longest world
 * axis; `inflate` grows every box uniformly (a margin — e.g. ~booster radius,
 * since collision tests the booster's centre point). Empty bins are dropped, so
 * the result has ≤ n boxes.
 */
export function segmentChain(node: Object3D, n: number, inflate = 0): Aabb[] {
  const pts = worldPoints(node);
  if (pts.length === 0) return [];

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const c = pts[i + a]!;
      if (c < min[a]!) min[a] = c;
      if (c > max[a]!) max[a] = c;
    }
  }
  const ext = [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
  const axis = ext[0]! >= ext[1]! && ext[0]! >= ext[2]! ? 0 : ext[1]! >= ext[2]! ? 1 : 2;
  const lo = min[axis]!;
  const span = (max[axis]! - lo) || 1;

  type Bin = { min: number[]; max: number[]; count: number };
  const bins: Bin[] = Array.from({ length: n }, () => ({
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
    count: 0,
  }));
  for (let i = 0; i < pts.length; i += 3) {
    let b = Math.floor(((pts[i + axis]! - lo) / span) * n);
    if (b < 0) b = 0;
    if (b >= n) b = n - 1;
    const bin = bins[b]!;
    for (let a = 0; a < 3; a++) {
      const c = pts[i + a]!;
      if (c < bin.min[a]!) bin.min[a] = c;
      if (c > bin.max[a]!) bin.max[a] = c;
    }
    bin.count++;
  }

  return bins
    .filter((b) => b.count > 0)
    .map((b) => ({
      center: Vec3.of(
        (b.min[0]! + b.max[0]!) / 2,
        (b.min[1]! + b.max[1]!) / 2,
        (b.min[2]! + b.max[2]!) / 2,
      ),
      halfExtents: Vec3.of(
        (b.max[0]! - b.min[0]!) / 2 + inflate,
        (b.max[1]! - b.min[1]!) / 2 + inflate,
        (b.max[2]! - b.min[2]!) / 2 + inflate,
      ),
    }));
}
