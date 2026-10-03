// 2D vector & polygon helpers. Plan coordinates are metres, +X east, +Y north.

export const EPS = 1e-9;

export const vec = (x = 0, y = 0) => ({ x, y });
export const copyPt = (p) => ({ x: p.x, y: p.y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
export const neg = (a) => ({ x: -a.x, y: -a.y });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const perp = (a) => ({ x: -a.y, y: a.x });
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const fromAngle = (r) => ({ x: Math.cos(r), y: Math.sin(r) });
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const near = (a, b, tol = 1e-6) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
export const roundTo = (v, step) => Math.round(v / step) * step;

export function norm(a) {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Project p onto segment ab. t is unclamped, point/dist use the clamped parameter. */
export function projectOnSegment(p, a, b) {
  const ab = sub(b, a);
  const L2 = dot(ab, ab);
  const t = L2 < EPS ? 0 : dot(sub(p, a), ab) / L2;
  const tc = clamp(t, 0, 1);
  const point = lerp(a, b, tc);
  return { t, tc, point, dist: dist(p, point) };
}

export const distToSegment = (p, a, b) => projectOnSegment(p, a, b).dist;

/** Solve p + d*s = q + e*u for s. Returns null for parallel lines. */
export function lineIntersect(p, d, q, e) {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-12) return null;
  return cross(sub(q, p), e) / den;
}

/** Signed area, positive for counter-clockwise loops. */
export function polygonArea(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function polygonPerimeter(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) s += dist(pts[i], pts[(i + 1) % n]);
  return s;
}

export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distToPolygonEdges(p, pts) {
  let best = Infinity;
  for (let i = 0, n = pts.length; i < n; i++) best = Math.min(best, distToSegment(p, pts[i], pts[(i + 1) % n]));
  return best;
}

export function polygonCentroid(pts) {
  const A = polygonArea(pts);
  if (Math.abs(A) < EPS) {
    const s = pts.reduce((acc, p) => add(acc, p), vec());
    return mul(s, 1 / Math.max(1, pts.length));
  }
  let cx = 0, cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const f = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

export function bounds(pts) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    b.minX = Math.min(b.minX, p.x); b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x); b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
}

/**
 * Offset every edge of a closed loop to its left by its own distance and re-intersect
 * neighbouring edges. dists[i] belongs to the edge pts[i] -> pts[i+1].
 */
export function offsetLeft(pts, dists) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const d0 = norm(sub(p1, p0)), d1 = norm(sub(p2, p1));
    const o0 = dists[(i - 1 + n) % n], o1 = dists[i];
    const A = add(p0, mul(perp(d0), o0));
    const B = add(p1, mul(perp(d1), o1));
    const s = Math.abs(cross(d0, d1)) < 1e-6 ? null : lineIntersect(A, d0, B, d1);
    if (s === null) {
      const q0 = add(p1, mul(perp(d0), o0));
      const q1 = add(p1, mul(perp(d1), o1));
      out.push(q0);
      if (dist(q0, q1) > 1e-6) out.push(q1);
    } else {
      out.push(add(A, mul(d0, s)));
    }
  }
  return out;
}

/** A comfortable point inside a polygon: the centroid when it is well inside, else the most interior grid point. */
export function interiorPoint(poly) {
  const c = polygonCentroid(poly);
  if (pointInPolygon(c, poly) && distToPolygonEdges(c, poly) > 0.4) return c;
  const b = bounds(poly);
  let best = null;
  for (let i = 1; i < 16; i++) {
    for (let j = 1; j < 16; j++) {
      const p = { x: b.minX + ((b.maxX - b.minX) * i) / 16, y: b.minY + ((b.maxY - b.minY) * j) / 16 };
      if (!pointInPolygon(p, poly)) continue;
      const d = distToPolygonEdges(p, poly);
      if (!best || d > best.d) best = { p, d };
    }
  }
  return best?.p ?? c;
}

// Formatting (internal unit is metres; UI shows millimetres like Revit's metric template)
export const toMM = (m) => Math.round(m * 1000);
export const fmtMM = (m) => `${toMM(m).toLocaleString('en-US')}`;
export const fmtArea = (a) => `${a.toFixed(2)} m²`;
export const fmtVol = (v) => `${v.toFixed(3)} m³`;
