// Turns raw wall candidates (from raster or DXF detection, in metres) into a clean wall network:
// merges duplicates, snaps ends onto neighbouring walls so corners and T-junctions join, and turns
// gaps between collinear walls (or between a wall end and a facing wall) into door/window openings.

import { add, sub, mul, dot, cross, dist, len, norm, perp, lineIntersect, projectOnSegment } from '../../core/geom.js';

const mk = (a, b, t) => {
  const d = norm(sub(b, a));
  return { a, b, t, d, n: perp(d), L: dist(a, b) };
};
const refresh = (w) => Object.assign(w, mk(w.a, w.b, w.t));
const parallel = (p, q, tol = 0.03) => Math.abs(cross(p.d, q.d)) < tol;

/** Collinear: parallel, centerlines within half a thickness, thicknesses comparable. */
function collinear(p, q) {
  if (!parallel(p, q)) return false;
  const off = Math.abs(dot(sub(q.a, p.a), p.n));
  return off < Math.max(p.t, q.t) * 0.5 && Math.abs(p.t - q.t) < Math.max(p.t, q.t) * 0.6;
}

/** Extent of q projected onto p's axis, as [lo, hi]. */
function span(p, q) {
  const s0 = dot(sub(q.a, p.a), p.d), s1 = dot(sub(q.b, p.a), p.d);
  return [Math.min(s0, s1), Math.max(s0, s1)];
}

function segmentsCross(a, b, c, d) {
  const r = sub(b, a), s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return false;
  const t = cross(sub(c, a), s) / den, u = cross(sub(c, a), r) / den;
  return t > 0.02 && t < 0.98 && u >= -0.02 && u <= 1.02;
}

/**
 * raw: [{ a, b, t }] in metres. extraOpenings: [{ center, width, kind }] found by the detector itself.
 * opts: { minLen, joinTol, minOpening, maxOpening, classify(p0, p1, t) => 'Door' | 'Window' }
 * Returns { walls: [{ a, b, t }], openings: [{ wall, u, width, kind }] }.
 */
export function cleanupWalls(raw, extraOpenings, opts) {
  const { minLen = 0.4, joinTol = 0.12, minOpening = 0.55, maxOpening = 2.6, classify = () => 'Door' } = opts;
  let walls = raw.filter((w) => dist(w.a, w.b) >= minLen * 0.5).map((w) => mk({ ...w.a }, { ...w.b }, w.t));
  const openings = extraOpenings.map((o) => ({ ...o }));

  // 1. merge collinear walls that overlap or (almost) touch
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < walls.length; i++) {
      for (let j = i + 1; j < walls.length; j++) {
        const p = walls[i], q = walls[j];
        if (!collinear(p, q)) continue;
        const [lo, hi] = span(p, q);
        if (lo > p.L + joinTol || hi < -joinTol) continue;
        const s0 = Math.min(0, lo), s1 = Math.max(p.L, hi);
        const off = mul(p.n, dot(sub(q.a, p.a), p.n) * (q.L / (p.L + q.L)));
        const t = (p.t * p.L + q.t * q.L) / (p.L + q.L);
        walls[i] = mk(add(add(p.a, mul(p.d, s0)), off), add(add(p.a, mul(p.d, s1)), off), t);
        walls.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }

  // 2. snap wall ends onto the centerline of the wall they run into (corners, T-junctions)
  const snapEnds = () => {
    for (const w of walls) {
      for (const end of ['a', 'b']) {
        const E = w[end];
        let best = null;
        for (const o of walls) {
          if (o === w || Math.abs(cross(w.d, o.d)) < 0.3) continue;
          const s = lineIntersect(o.a, o.d, w.a, w.d);
          if (s === null) continue;
          const reach = o.t / 2 + w.t / 2 + joinTol;
          if (s < -reach || s > o.L + reach) continue;
          const X = add(o.a, mul(o.d, s));
          const dEnd = dist(X, E);
          if (dEnd <= o.t / 2 + w.t / 2 + joinTol && (!best || dEnd < best.d)) best = { X, d: dEnd };
        }
        if (best) w[end] = best.X;
      }
      refresh(w);
    }
  };
  snapEnds();
  snapEnds();

  const isJoined = (w, E) => walls.some((o) => o !== w && projectOnSegment(E, o.a, o.b).dist < o.t / 2 + 0.01);

  // 3. gaps between collinear walls become openings
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < walls.length; i++) {
      for (let j = 0; j < walls.length; j++) {
        if (i === j) continue;
        const p = walls[i], q = walls[j];
        if (!collinear(p, q)) continue;
        const [lo, hi] = span(p, q);
        const gap = lo - p.L;
        if (gap < minOpening || gap > maxOpening) continue;
        const g0 = p.b, g1 = add(p.a, mul(p.d, lo));
        if (walls.some((o) => o !== p && o !== q && segmentsCross(g0, g1, o.a, o.b))) continue;
        openings.push({ center: mul(add(g0, g1), 0.5), width: gap, kind: classify(g0, g1, Math.max(p.t, q.t)) });
        walls[i] = mk(p.a, add(p.a, mul(p.d, hi)), Math.max(p.t, q.t));
        walls.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }

  // 4. a free wall end that stops short of a facing wall leaves a door-sized gap
  for (const w of walls) {
    for (const end of ['a', 'b']) {
      const E = w[end];
      if (isJoined(w, E)) continue;
      const dir = end === 'b' ? w.d : mul(w.d, -1);
      let best = null;
      for (const o of walls) {
        if (o === w || Math.abs(cross(dir, o.d)) < 0.7) continue;
        const s = lineIntersect(E, dir, o.a, o.d);
        if (s === null || s <= 0) continue;
        const X = add(E, mul(dir, s));
        const pr = projectOnSegment(X, o.a, o.b);
        if (pr.dist > 0.02) continue;
        const gap = s - o.t / 2;
        if (gap < minOpening || gap > Math.min(maxOpening, 1.4)) continue;
        if (!best || s < best.s) best = { X, s, gap, o };
      }
      if (!best) continue;
      const g1 = add(E, mul(dir, best.gap));
      openings.push({ center: mul(add(E, g1), 0.5), width: best.gap, kind: classify(E, g1, w.t) });
      w[end] = best.X;
      refresh(w);
    }
  }

  walls = walls.filter((w) => w.L >= minLen);

  // 5. host every opening on the wall that contains it
  const hosted = [];
  for (const o of openings) {
    let host = -1, bestD = Infinity;
    walls.forEach((w, i) => {
      const pr = projectOnSegment(o.center, w.a, w.b);
      if (pr.dist < w.t / 2 + 0.05 && pr.dist < bestD && pr.t > 0 && pr.t < 1) { host = i; bestD = pr.dist; }
    });
    if (host < 0) continue;
    const w = walls[host];
    const u = dot(sub(o.center, w.a), w.d);
    if (u - o.width / 2 < 0.05 || u + o.width / 2 > w.L - 0.05) continue;
    if (hosted.some((h) => h.wall === host && Math.abs(h.u - u) < (h.width + o.width) / 2)) continue;
    hosted.push({ wall: host, u, width: o.width, kind: o.kind });
  }

  return { walls: walls.map((w) => ({ a: w.a, b: w.b, t: w.t })), openings: hosted };
}

/** Bounding box of cleaned walls, for re-centering imports at the origin. */
export function wallsBounds(walls) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of walls) {
    for (const p of [w.a, w.b]) {
      minX = Math.min(minX, p.x - w.t / 2); minY = Math.min(minY, p.y - w.t / 2);
      maxX = Math.max(maxX, p.x + w.t / 2); maxY = Math.max(maxY, p.y + w.t / 2);
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, empty: !walls.length };
}

export const totalLength = (walls) => walls.reduce((s, w) => s + len(sub(w.b, w.a)), 0);
