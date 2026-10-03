// Object snaps: endpoints, midpoints, wall faces, grid intersections, 15° angle steps and
// alignment with existing points, then length rounding scaled to the zoom level.

import { add, sub, mul, len, lerp, dist, fromAngle, roundTo, lineIntersect, projectOnSegment } from '../core/geom.js';
import { wallFootprint } from '../core/regen.js';
import { planVisibility } from './planRender.js';

export function lengthIncrement(view) {
  if (view.scale >= 150) return 0.01;
  if (view.scale >= 40) return 0.05;
  if (view.scale >= 15) return 0.1;
  return 0.5;
}

export function collectSnapTargets(app, exclude = new Set()) {
  const vis = planVisibility(app);
  const pts = [];
  const lines = [];
  for (const f of vis.walls) {
    if (exclude.has(f.id)) continue;
    pts.push({ p: f.a, kind: 'endpoint' }, { p: f.b, kind: 'endpoint' }, { p: lerp(f.a, f.b, 0.5), kind: 'midpoint' });
    lines.push({ a: f.a, b: f.b, kind: 'wall', id: f.id });
    const fp = wallFootprint(f);
    lines.push({ a: fp[0], b: fp[1], kind: 'face' }, { a: fp[3], b: fp[2], kind: 'face' });
    fp.forEach((p) => pts.push({ p, kind: 'endpoint' }));
  }
  for (const fl of vis.floors) {
    if (exclude.has(fl.id)) continue;
    fl.boundary.forEach((p, i) => {
      pts.push({ p, kind: 'endpoint' });
      lines.push({ a: p, b: fl.boundary[(i + 1) % fl.boundary.length], kind: 'edge' });
    });
  }
  for (const c of vis.columns) if (!exclude.has(c.id)) pts.push({ p: { x: c.x, y: c.y }, kind: 'center' });
  const grids = vis.grids.filter((g) => !exclude.has(g.id));
  for (const g of grids) {
    lines.push({ a: g.a, b: g.b, kind: 'grid' });
    pts.push({ p: g.a, kind: 'endpoint' }, { p: g.b, kind: 'endpoint' });
  }
  for (let i = 0; i < grids.length; i++) {
    for (let j = i + 1; j < grids.length; j++) {
      const A = grids[i], B = grids[j];
      const s = lineIntersect(A.a, sub(A.b, A.a), B.a, sub(B.b, B.a));
      if (s === null || s < 0 || s > 1) continue;
      const p = add(A.a, mul(sub(A.b, A.a), s));
      if (projectOnSegment(p, B.a, B.b).dist < 1e-6) pts.push({ p, kind: 'intersection' });
    }
  }
  return { pts, lines };
}

/**
 * opts.anchor  – previous point of the current sketch (enables angle snapping)
 * opts.ortho   – force 90° steps (Shift)
 * opts.exclude – element ids to ignore (elements being moved)
 * opts.lines   – set false to skip nearest-on-line snapping
 * Returns { p, kind, guide? }.
 */
export function snap(app, view, raw, opts = {}) {
  const tol = 10 / view.scale;
  const T = collectSnapTargets(app, opts.exclude);

  let best = null;
  for (const t of T.pts) {
    const d = dist(raw, t.p);
    if (d < tol && (!best || d < best.d - 1e-9)) best = { ...t, d };
  }
  if (best) return { p: { x: best.p.x, y: best.p.y }, kind: best.kind };

  let nearLine = null;
  if (opts.lines !== false) {
    for (const l of T.lines) {
      const pr = projectOnSegment(raw, l.a, l.b);
      if (pr.dist < tol * 0.8 && (!nearLine || pr.dist < nearLine.d)) nearLine = { p: pr.point, d: pr.dist, line: l };
    }
  }

  if (opts.anchor) {
    const v = sub(raw, opts.anchor);
    let L = len(v);
    let ang = Math.atan2(v.y, v.x);
    let snapped = false;
    const step = opts.ortho ? Math.PI / 2 : Math.PI / 12;
    const target = Math.round(ang / step) * step;
    if (opts.ortho || Math.abs(target - ang) < (4 * Math.PI) / 180) {
      ang = target;
      snapped = true;
    }
    const dir = fromAngle(ang);
    if (nearLine) {
      if (!snapped) return { p: nearLine.p, kind: 'nearest' };
      const l = nearLine.line;
      const s = lineIntersect(opts.anchor, dir, l.a, sub(l.b, l.a));
      if (s !== null && s > 1e-6) {
        const q = add(opts.anchor, mul(dir, s));
        if (projectOnSegment(q, l.a, l.b).dist < 1e-6 && dist(q, raw) < tol * 2) return { p: q, kind: 'intersection' };
      }
    }
    if (snapped) {
      // Alignment: stop the ray where it lines up with an existing point.
      for (const t of T.pts) {
        if (Math.abs(dir.x) > 0.999 && Math.abs(raw.x - t.p.x) < tol) {
          const s = (t.p.x - opts.anchor.x) / dir.x;
          if (s > 0) return { p: add(opts.anchor, mul(dir, s)), kind: 'align', guide: { a: t.p, b: add(opts.anchor, mul(dir, s)) } };
        }
        if (Math.abs(dir.y) > 0.999 && Math.abs(raw.y - t.p.y) < tol) {
          const s = (t.p.y - opts.anchor.y) / dir.y;
          if (s > 0) return { p: add(opts.anchor, mul(dir, s)), kind: 'align', guide: { a: t.p, b: add(opts.anchor, mul(dir, s)) } };
        }
      }
    }
    L = roundTo(L, lengthIncrement(view));
    return { p: add(opts.anchor, mul(dir, L)), kind: snapped ? 'angle' : 'free' };
  }

  if (nearLine) return { p: nearLine.p, kind: 'nearest' };

  const inc = lengthIncrement(view);
  const p = { x: roundTo(raw.x, inc), y: roundTo(raw.y, inc) };
  for (const t of T.pts) {
    if (Math.abs(raw.x - t.p.x) < tol) { p.x = t.p.x; return { p, kind: 'align', guide: { a: t.p, b: { ...p } } }; }
    if (Math.abs(raw.y - t.p.y) < tol) { p.y = t.p.y; return { p, kind: 'align', guide: { a: t.p, b: { ...p } } }; }
  }
  return { p, kind: 'free' };
}
