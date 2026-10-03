// Minimal ASCII DXF reader (LINE, LWPOLYLINE, POLYLINE/VERTEX, ARC, CIRCLE, INSERT with block
// expansion) and double-line wall extraction for CAD floor plans.

import { add, sub, mul, dot, cross, dist, norm, perp } from '../../core/geom.js';

const UNIT_TO_M = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 14: 0.1 };
export const DXF_UNITS = [['auto', 'Auto'], ['0.001', 'Millimetres'], ['0.01', 'Centimetres'], ['1', 'Metres'], ['0.0254', 'Inches'], ['0.3048', 'Feet']];

function readPairs(text) {
  const lines = text.split(/\r\n|\n|\r/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([lines[i].trim(), lines[i + 1].trim()]);
  return pairs;
}

/** Reads entities from pairs[i] (a "0" code) until `stop` returns true; returns [entities, nextIndex]. */
function readEntities(pairs, i, stop) {
  const ents = [];
  while (i < pairs.length && !stop(pairs[i])) {
    if (pairs[i][0] !== '0') { i++; continue; }
    const ent = { type: pairs[i][1], codes: [] };
    i++;
    while (i < pairs.length && pairs[i][0] !== '0') { ent.codes.push(pairs[i]); i++; }
    ents.push(ent);
  }
  return [ents, i];
}

const num = (ent, code, fallback = 0) => {
  const p = ent.codes.find((c) => c[0] === code);
  return p ? parseFloat(p[1]) : fallback;
};
const str = (ent, code, fallback = '') => ent.codes.find((c) => c[0] === code)?.[1] ?? fallback;

function arcPoints(cx, cy, r, a0, a1) {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += 360;
  const n = Math.max(4, Math.ceil(sweep / 10));
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const a = ((a0 + (sweep * k) / n) * Math.PI) / 180;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/** Parses an ASCII DXF. Returns { unitsToM (null if unknown), segments: [{ a, b, layer, arc }], layers }. */
export function parseDXF(text) {
  const pairs = readPairs(text);
  let unitsToM = null;
  const iu = pairs.findIndex((p) => p[0] === '9' && p[1] === '$INSUNITS');
  if (iu >= 0 && pairs[iu + 1]?.[0] === '70') unitsToM = UNIT_TO_M[parseInt(pairs[iu + 1][1], 10)] ?? null;

  const blocks = new Map();
  const bi = pairs.findIndex((p, k) => p[0] === '2' && p[1] === 'BLOCKS' && pairs[k - 1]?.[1] === 'SECTION');
  if (bi >= 0) {
    let i = bi + 1;
    while (i < pairs.length && !(pairs[i][0] === '0' && pairs[i][1] === 'ENDSEC')) {
      if (pairs[i][0] === '0' && pairs[i][1] === 'BLOCK') {
        const head = { type: 'BLOCK', codes: [] };
        i++;
        while (i < pairs.length && pairs[i][0] !== '0') { head.codes.push(pairs[i]); i++; }
        const [ents, next] = readEntities(pairs, i, (p) => p[0] === '0' && p[1] === 'ENDBLK');
        blocks.set(str(head, '2'), { base: { x: num(head, '10'), y: num(head, '20') }, ents });
        i = next + 1;
      } else i++;
    }
  }

  const ei = pairs.findIndex((p, k) => p[0] === '2' && p[1] === 'ENTITIES' && pairs[k - 1]?.[1] === 'SECTION');
  const [entities] = ei >= 0 ? readEntities(pairs, ei + 1, (p) => p[0] === '0' && p[1] === 'ENDSEC') : [[]];

  const segments = [];
  const layers = new Set();
  const identity = (p) => p;

  const emit = (ents, xf, depth, inheritedLayer) => {
    for (let k = 0; k < ents.length; k++) {
      const e = ents[k];
      let layer = str(e, '8', inheritedLayer || '0');
      if (layer === '0' && inheritedLayer) layer = inheritedLayer;
      const seg = (p, q, arc = false) => {
        const a = xf(p), b = xf(q);
        if (dist(a, b) > 1e-9) { segments.push({ a, b, layer, arc }); layers.add(layer); }
      };
      const poly = (pts, closed, arc = false) => {
        for (let j = 0; j + 1 < pts.length; j++) seg(pts[j], pts[j + 1], arc);
        if (closed && pts.length > 2) seg(pts[pts.length - 1], pts[0], arc);
      };
      switch (e.type) {
        case 'LINE':
          seg({ x: num(e, '10'), y: num(e, '20') }, { x: num(e, '11'), y: num(e, '21') });
          break;
        case 'LWPOLYLINE': {
          const pts = [];
          for (const [c, v] of e.codes) {
            if (c === '10') pts.push({ x: parseFloat(v), y: 0 });
            else if (c === '20' && pts.length) pts[pts.length - 1].y = parseFloat(v);
          }
          poly(pts, (num(e, '70') & 1) === 1);
          break;
        }
        case 'POLYLINE': {
          const pts = [];
          let j = k + 1;
          while (j < ents.length && ents[j].type === 'VERTEX') {
            pts.push({ x: num(ents[j], '10'), y: num(ents[j], '20') });
            j++;
          }
          if (ents[j]?.type === 'SEQEND') j++;
          poly(pts, (num(e, '70') & 1) === 1);
          k = j - 1;
          break;
        }
        case 'ARC':
          poly(arcPoints(num(e, '10'), num(e, '20'), num(e, '40'), num(e, '50'), num(e, '51')), false, true);
          break;
        case 'CIRCLE':
          poly(arcPoints(num(e, '10'), num(e, '20'), num(e, '40'), 0, 360), false, true);
          break;
        case 'INSERT': {
          const block = blocks.get(str(e, '2'));
          if (!block || depth > 6) break;
          const ins = { x: num(e, '10'), y: num(e, '20') };
          const sx = num(e, '41', 1), sy = num(e, '42', 1);
          const r = (num(e, '50') * Math.PI) / 180;
          const c = Math.cos(r), s = Math.sin(r);
          const local = (p) => {
            const x = (p.x - block.base.x) * sx, y = (p.y - block.base.y) * sy;
            return xf({ x: ins.x + x * c - y * s, y: ins.y + x * s + y * c });
          };
          emit(block.ents, local, depth + 1, layer);
          break;
        }
        default:
          break;
      }
    }
  };
  emit(entities, identity, 0, '');
  return { unitsToM, segments, layers: [...layers].sort() };
}

/** Guess units when the file doesn't say: big coordinates are almost always millimetres. */
export function guessUnits(segments) {
  let max = 0;
  for (const s of segments) max = Math.max(max, Math.abs(s.a.x - s.b.x), Math.abs(s.a.y - s.b.y));
  return max > 400 ? 0.001 : 1;
}

/**
 * Wall candidates from double lines: nearest parallel partner lines within the thickness range
 * and overlapping by at least minLen. Segments must already be in metres.
 */
export function dxfWallCandidates(segments, { minThick, maxThick, minLen }) {
  const lines = segments
    .filter((s) => !s.arc && dist(s.a, s.b) >= minLen * 0.5)
    .map((s) => {
      const d = norm(sub(s.b, s.a));
      return { a: s.a, b: s.b, d, n: perp(d), L: dist(s.a, s.b), used: { 1: [], '-1': [] } };
    });
  const cands = [];
  for (let i = 0; i < lines.length; i++) {
    const p = lines[i];
    for (let j = i + 1; j < lines.length; j++) {
      const q = lines[j];
      if (Math.abs(cross(p.d, q.d)) > 0.035) continue;
      const sep = dot(sub(q.a, p.a), p.n);
      if (Math.abs(sep) < minThick * 0.9 || Math.abs(sep) > maxThick * 1.1) continue;
      const s0 = dot(sub(q.a, p.a), p.d), s1 = dot(sub(q.b, p.a), p.d);
      const lo = Math.max(0, Math.min(s0, s1)), hi = Math.min(p.L, Math.max(s0, s1));
      if (hi - lo < minLen) continue;
      cands.push({ i, j, sep, lo, hi });
    }
  }
  cands.sort((x, y) => Math.abs(x.sep) - Math.abs(y.sep));
  const overlaps = (list, lo, hi) => list.some(([a, b]) => Math.min(b, hi) - Math.max(a, lo) > 0.5 * (hi - lo));
  const walls = [];
  for (const c of cands) {
    const p = lines[c.i], q = lines[c.j];
    const side = Math.sign(c.sep);
    // the same stretch on q, in q's own parameter
    const qa = dot(sub(add(p.a, mul(p.d, c.lo)), q.a), q.d), qb = dot(sub(add(p.a, mul(p.d, c.hi)), q.a), q.d);
    const qlo = Math.min(qa, qb), qhi = Math.max(qa, qb);
    const qSide = Math.sign(dot(sub(p.a, q.a), q.n)) || -side;
    if (overlaps(p.used[side], c.lo, c.hi) || overlaps(q.used[qSide], qlo, qhi)) continue;
    p.used[side].push([c.lo, c.hi]);
    q.used[qSide].push([qlo, qhi]);
    const off = mul(p.n, c.sep / 2);
    walls.push({ a: add(add(p.a, mul(p.d, c.lo)), off), b: add(add(p.a, mul(p.d, c.hi)), off), t: Math.abs(c.sep) });
  }
  return walls;
}

/** Window if at least two lines parallel to the wall run across most of the gap. */
export function dxfGapClassifier(segments) {
  const plain = segments.filter((s) => !s.arc);
  return (p0, p1, t) => {
    const gap = dist(p0, p1);
    if (gap < 1e-6) return 'Door';
    const d = norm(sub(p1, p0)), n = perp(d);
    let lines = 0;
    for (const s of plain) {
      const sd = norm(sub(s.b, s.a));
      if (Math.abs(cross(sd, d)) > 0.05) continue;
      const m = mul(add(s.a, s.b), 0.5);
      const along = dot(sub(m, p0), d), across = Math.abs(dot(sub(m, p0), n));
      if (along < 0 || along > gap || across > t / 2 + 0.03) continue;
      if (dist(s.a, s.b) >= 0.5 * gap) lines++;
    }
    return lines >= 2 ? 'Window' : 'Door';
  };
}
