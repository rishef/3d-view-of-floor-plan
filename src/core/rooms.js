// Room / region detection.
// Wall centerlines are turned into a planar graph (split at every crossing and T-junction),
// faces are traced with the "next edge clockwise" rule, and the face that contains a point is
// the enclosed region. Region boundaries are then offset to the wall finish faces so that room
// areas are net areas, as in Revit.

import { sub, len, dot, cross, dist, lerp, clamp, polygonArea, polygonPerimeter, pointInPolygon, offsetLeft } from './geom.js';

/** Parameter pairs [ti, tj] where segments s1 and s2 touch or cross (with tolerance). */
function intersections(s1, s2, tol) {
  const r = sub(s1.b, s1.a), s = sub(s2.b, s2.a);
  const L1 = len(r), L2 = len(s);
  if (L1 < tol || L2 < tol) return [];
  const out = [];
  const den = cross(r, s);
  if (Math.abs(den) > 1e-9 * L1 * L2) {
    const qp = sub(s2.a, s1.a);
    const t = cross(qp, s) / den;
    const u = cross(qp, r) / den;
    const et = tol / L1, eu = tol / L2;
    if (t >= -et && t <= 1 + et && u >= -eu && u <= 1 + eu) out.push([clamp(t, 0, 1), clamp(u, 0, 1)]);
    return out;
  }
  // Parallel: only collinear overlaps matter.
  if (Math.abs(cross(sub(s2.a, s1.a), r)) / L1 > tol) return out;
  for (const [p, u] of [[s2.a, 0], [s2.b, 1]]) {
    const t = dot(sub(p, s1.a), r) / (L1 * L1);
    if (t > -tol / L1 && t < 1 + tol / L1) out.push([clamp(t, 0, 1), u]);
  }
  for (const [p, t] of [[s1.a, 0], [s1.b, 1]]) {
    const u = dot(sub(p, s2.a), s) / (L2 * L2);
    if (u > -tol / L2 && u < 1 + tol / L2) out.push([t, clamp(u, 0, 1)]);
  }
  return out;
}

/**
 * segs: [{ a, b, t (thickness), id }]
 * Returns { verts, faces: [{ loop: [{ p, seg }], area, comp }], segs }.
 * Bounded faces are counter-clockwise (area > 0); each connected component also has one
 * clockwise outer face (area < 0).
 */
export function buildPlanarGraph(segs, tol = 1e-3) {
  const verts = [];
  const vid = (p) => {
    for (let i = 0; i < verts.length; i++) {
      if (Math.abs(verts[i].x - p.x) <= tol && Math.abs(verts[i].y - p.y) <= tol) return i;
    }
    verts.push({ x: p.x, y: p.y });
    return verts.length - 1;
  };

  const params = segs.map(() => [0, 1]);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      for (const [ti, tj] of intersections(segs[i], segs[j], tol)) {
        params[i].push(ti);
        params[j].push(tj);
      }
    }
  }

  const edges = new Map(); // "u,v" (u < v) -> segment index
  segs.forEach((s, i) => {
    if (dist(s.a, s.b) < tol) return;
    const ts = [...new Set(params[i])].sort((x, y) => x - y);
    let prev = null;
    for (const t of ts) {
      const id = vid(lerp(s.a, s.b, t));
      if (prev !== null && prev !== id) {
        const k = prev < id ? `${prev},${id}` : `${id},${prev}`;
        if (!edges.has(k)) edges.set(k, i);
      }
      prev = id;
    }
  });

  const adj = verts.map(() => []);
  for (const k of edges.keys()) {
    const [u, v] = k.split(',').map(Number);
    adj[u].push(v);
    adj[v].push(u);
  }
  const angle = (u, v) => Math.atan2(verts[v].y - verts[u].y, verts[v].x - verts[u].x);
  adj.forEach((list, u) => list.sort((p, q) => angle(u, p) - angle(u, q)));

  // Connected components via union-find
  const parent = verts.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const k of edges.keys()) {
    const [u, v] = k.split(',').map(Number);
    parent[find(u)] = find(v);
  }

  const visited = new Set();
  const faces = [];
  for (let u0 = 0; u0 < verts.length; u0++) {
    for (const v0 of adj[u0]) {
      if (visited.has(`${u0}>${v0}`)) continue;
      const loop = [];
      let a = u0, b = v0, guard = 0;
      while (!visited.has(`${a}>${b}`) && guard++ < 100000) {
        visited.add(`${a}>${b}`);
        loop.push({ p: verts[a], seg: edges.get(a < b ? `${a},${b}` : `${b},${a}`) });
        const list = adj[b];
        const idx = list.indexOf(a);
        const next = list[(idx - 1 + list.length) % list.length];
        a = b;
        b = next;
      }
      faces.push({ loop, area: polygonArea(loop.map((l) => l.p)), comp: find(u0) });
    }
  }
  return { verts, faces, segs };
}

/** Removes there-and-back spikes produced by free-standing wall ends. */
function cleanLoop(loop) {
  let L = loop.map((x) => ({ ...x }));
  let changed = true;
  while (changed && L.length > 2) {
    changed = false;
    for (let i = 0; i < L.length; i++) {
      const n = L.length;
      const prev = L[(i - 1 + n) % n], next = L[(i + 1) % n];
      if (dist(prev.p, next.p) < 1e-9) {
        prev.seg = next.seg;
        const j = (i + 1) % n;
        L = L.filter((_, k) => k !== i && k !== j);
        changed = true;
        break;
      }
    }
  }
  return L;
}

const halfThickness = (graph, loop) => loop.map((l) => (graph.segs[l.seg]?.t ?? 0) / 2);

/** The enclosed region containing p, measured to wall finish faces. */
export function regionAt(graph, p) {
  let best = null;
  for (const f of graph.faces) {
    if (f.area <= 1e-6) continue;
    if (!pointInPolygon(p, f.loop.map((l) => l.p))) continue;
    if (!best || f.area < best.area) best = f;
  }
  if (!best) return null;

  const outerLoop = cleanLoop(best.loop);
  const centerline = outerLoop.map((l) => l.p);
  // Islands: outer faces of other components sitting inside this region
  const holes = graph.faces.filter((f) => f.area < -1e-6 && f.comp !== best.comp && pointInPolygon(f.loop[0].p, centerline));

  const outer = offsetLeft(centerline, halfThickness(graph, outerLoop));
  const holeLoops = holes.map((h) => {
    const c = cleanLoop(h.loop);
    return offsetLeft(c.map((l) => l.p), halfThickness(graph, c));
  });
  const area = Math.abs(polygonArea(outer)) - holeLoops.reduce((s, h) => s + Math.abs(polygonArea(h)), 0);
  const perimeter = polygonPerimeter(outer) + holeLoops.reduce((s, h) => s + polygonPerimeter(h), 0);
  return { outer, holes: holeLoops, area, perimeter, centerline, face: best };
}

/** Exterior-face outline of the wall network that the given wall belongs to ("Pick Walls"). */
export function outerBoundary(graph, wallId) {
  const segIndex = graph.segs.findIndex((s) => s.id === wallId);
  if (segIndex < 0) return null;
  const owner = graph.faces.find((f) => f.loop.some((l) => l.seg === segIndex));
  if (!owner) return null;
  let outer = null;
  for (const f of graph.faces) if (f.comp === owner.comp && (!outer || f.area < outer.area)) outer = f;
  if (!outer || outer.area > -1e-6) return null;
  const loop = cleanLoop(outer.loop);
  // The outer face lies to the left of its loop, so offsetting left reaches the exterior face.
  return offsetLeft(loop.map((l) => l.p), halfThickness(graph, loop)).reverse();
}
