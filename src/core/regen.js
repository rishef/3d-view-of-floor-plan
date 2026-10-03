// "Regeneration": derives analytic geometry from the stored parameters, like Revit's regen.
// Views never compute geometry themselves; they read the model produced here, so plan, 3D,
// schedules and exports always agree.

import { sub, add, mul, neg, norm, perp, dist, dot, cross, near, clamp, lineIntersect, polygonArea, polygonPerimeter } from './geom.js';
import { buildPlanarGraph, regionAt } from './rooms.js';
import { placeContext } from './site.js';

const JOIN_TOL = 1e-3;

/** Point at distance u along a wall's location line and v to its left (interior side for CCW loops). */
export function wallPoint(f, u, v = 0) {
  return { x: f.a.x + f.d.x * u + f.n.x * v, y: f.a.y + f.d.y * u + f.n.y * v };
}

/** Plan outline of a wall after joins: start-left, end-left, end-right, start-right. */
export function wallFootprint(f) {
  const h = f.t / 2;
  return [wallPoint(f, f.uSL, h), wallPoint(f, f.uEL, h), wallPoint(f, f.uER, -h), wallPoint(f, f.uSR, -h)];
}

/** The wall outline split around opening spans (sorted, non-overlapping). */
export function wallPieces(f, spans) {
  const h = f.t / 2;
  const P = (u, s) => wallPoint(f, u, s * h);
  const pieces = [];
  let curL = f.uSL, curR = f.uSR;
  for (const s of spans) {
    pieces.push([P(curL, 1), P(s.u0, 1), P(s.u0, -1), P(curR, -1)]);
    curL = curR = s.u1;
  }
  pieces.push([P(curL, 1), P(f.uEL, 1), P(f.uER, -1), P(curR, -1)]);
  return pieces;
}

export function columnCorners(c) {
  const r = (c.rot * Math.PI) / 180;
  const ux = { x: Math.cos(r), y: Math.sin(r) };
  const uy = perp(ux);
  const hx = c.w / 2, hy = c.dd / 2;
  const at = (sx, sy) => ({ x: c.x + ux.x * sx * hx + uy.x * sy * hy, y: c.y + ux.y * sx * hx + uy.y * sy * hy });
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
}

export function regenerate(doc) {
  const elevOf = (id) => doc.get(id)?.elevation ?? 0;
  const model = {
    walls: new Map(), openings: new Map(), columns: new Map(), rooms: new Map(), context: new Map(),
    warnings: [], graphs: new Map(), footprint: [],
  };

  // ---- walls -----------------------------------------------------------------
  for (const w of doc.byCategory('Wall')) {
    const type = doc.type(w.typeId);
    const t = Math.max(0.01, type?.thickness ?? 0.2);
    const L = dist(w.a, w.b);
    if (L < 1e-4) {
      model.warnings.push({ id: w.id, message: 'Wall has zero length' });
      continue;
    }
    const d = norm(sub(w.b, w.a));
    const baseZ = elevOf(w.levelId) + (w.baseOffset || 0);
    let topZ = baseZ + Math.max(0.1, w.height || 3);
    if (w.topLevelId && doc.get(w.topLevelId)) {
      const z = elevOf(w.topLevelId) + (w.topOffset || 0);
      if (z > baseZ + 0.05) topZ = z;
      else model.warnings.push({ id: w.id, message: 'Wall top constraint is below its base; using unconnected height' });
    }
    model.walls.set(w.id, {
      id: w.id, wall: w, type, a: w.a, b: w.b, d, n: perp(d), L, t,
      baseZ, topZ, H: topZ - baseZ,
      uSL: 0, uSR: 0, uEL: L, uER: L, // join-adjusted ends of the left/right faces
      openings: [],
    });
  }
  computeJoins(model);

  // ---- hosted openings -------------------------------------------------------
  for (const el of doc.all()) {
    if (el.category !== 'Door' && el.category !== 'Window') continue;
    const host = model.walls.get(el.hostId);
    const type = doc.type(el.typeId);
    if (!host || !type) {
      model.warnings.push({ id: el.id, message: `${el.category} ${el.mark || ''} has no valid host wall` });
      continue;
    }
    const z0 = el.category === 'Door' ? 0 : (el.sill ?? type.defaultSill ?? 0.9);
    const op = {
      id: el.id, el, type, kind: el.category, host,
      u0: el.t - type.width / 2, u1: el.t + type.width / 2,
      z0, z1: z0 + type.height, valid: true,
    };
    host.openings.push(op);
    model.openings.set(el.id, op);
  }
  for (const f of model.walls.values()) {
    f.openings.sort((p, q) => p.u0 - q.u0);
    const uMin = Math.max(f.uSL, f.uSR), uMax = Math.min(f.uEL, f.uER);
    let last = -Infinity;
    for (const o of f.openings) {
      let problem = null;
      if (o.u0 < uMin - 1e-6 || o.u1 > uMax + 1e-6) problem = 'extends beyond the end of its wall';
      else if (o.u0 < last + 1e-6) problem = 'overlaps another opening';
      else if (o.z1 > f.H - 0.01) problem = 'is taller than its host wall';
      else if (o.z0 < 0) problem = 'has a negative sill height';
      if (problem) {
        o.valid = false;
        model.warnings.push({ id: o.id, message: `${o.kind} ${o.el.mark || ''} ${problem}` });
      } else {
        last = o.u1;
      }
    }
  }

  // ---- columns ---------------------------------------------------------------
  for (const el of doc.byCategory('Column')) {
    const type = doc.type(el.typeId);
    const baseZ = elevOf(el.levelId) + (el.baseOffset || 0);
    let topZ = baseZ + Math.max(0.1, el.height || 3);
    if (el.topLevelId && doc.get(el.topLevelId)) {
      const z = elevOf(el.topLevelId);
      if (z > baseZ + 0.05) topZ = z;
    }
    model.columns.set(el.id, {
      id: el.id, el, type, x: el.x, y: el.y,
      w: type?.width ?? 0.4, dd: type?.depth ?? 0.4, rot: el.rotation || 0, baseZ, topZ,
    });
  }

  // ---- site context (nearby buildings, placed relative to our footprint) -------
  for (const f of model.walls.values()) model.footprint.push(...wallFootprint(f));
  for (const fl of doc.byCategory('Floor')) model.footprint.push(...fl.boundary);
  for (const el of doc.byCategory('Context')) model.context.set(el.id, placeContext(el, model.footprint, doc.site));
  model.groundZ = Math.min(0, ...doc.levels().map((l) => l.elevation));

  // ---- rooms -----------------------------------------------------------------
  model.graphFor = (levelId) => {
    if (!model.graphs.has(levelId)) {
      const probe = elevOf(levelId) + 0.5;
      const segs = [...model.walls.values()]
        .filter((f) => f.baseZ <= probe && f.topZ > probe)
        .map((f) => ({ a: f.a, b: f.b, t: f.t, id: f.id }));
      model.graphs.set(levelId, buildPlanarGraph(segs));
    }
    return model.graphs.get(levelId);
  };

  const claimed = new Map();
  for (const el of doc.byCategory('Room')) {
    const region = regionAt(model.graphFor(el.levelId), { x: el.x, y: el.y });
    model.rooms.set(el.id, region);
    if (!region) {
      model.warnings.push({ id: el.id, message: `Room ${el.number} "${el.name}" is not in a properly enclosed region` });
      continue;
    }
    if (claimed.has(region.face)) {
      model.warnings.push({ id: el.id, message: `Room ${el.number} shares an enclosed region with room ${claimed.get(region.face)}` });
    } else {
      claimed.set(region.face, el.number);
    }
  }

  return model;
}

/** Miter L-junctions: where exactly two walls meet at an endpoint, intersect their faces. */
function computeJoins(model) {
  const frames = [...model.walls.values()];
  for (const F of frames) {
    for (const atStart of [true, false]) {
      const J = atStart ? F.a : F.b;
      const others = frames.filter((O) => O !== F && O.wall.levelId === F.wall.levelId && (near(O.a, J, JOIN_TOL) || near(O.b, J, JOIN_TOL)));
      if (others.length !== 1) continue;
      const O = others[0];
      const out = atStart ? F.d : neg(F.d);
      const oOut = near(O.a, J, JOIN_TOL) ? O.d : neg(O.d);
      if (Math.abs(cross(out, oOut)) < 1e-4) continue; // collinear: plain butt joint
      const limit = 4 * Math.max(F.t, O.t);
      const uJ = atStart ? 0 : F.L;
      for (const s of [1, -1]) {
        const P = add(J, mul(F.n, (s * F.t) / 2));
        const inner = dot(mul(F.n, s), oOut) > 0;
        const s2 = (dot(O.n, out) > 0 ? 1 : -1) * (inner ? 1 : -1);
        const Q = add(J, mul(O.n, (s2 * O.t) / 2));
        const lam = lineIntersect(P, F.d, Q, O.d);
        if (lam === null) continue;
        const u = clamp(dot(sub(add(P, mul(F.d, lam)), F.a), F.d), uJ - limit, uJ + limit);
        if (atStart) { if (s > 0) F.uSL = u; else F.uSR = u; }
        else if (s > 0) F.uEL = u; else F.uER = u;
      }
    }
  }
}

// ---- quantities ----------------------------------------------------------------
export function wallQuantities(f) {
  const valid = f.openings.filter((o) => o.valid);
  const openArea = valid.reduce((s, o) => s + (o.u1 - o.u0) * (o.z1 - o.z0), 0);
  const footprint = Math.abs(polygonArea(wallFootprint(f)));
  return {
    length: f.L,
    height: f.H,
    grossArea: f.L * f.H,
    netArea: f.L * f.H - openArea,
    volume: footprint * f.H - openArea * f.t,
  };
}

export function floorQuantities(el, type) {
  const area = Math.abs(polygonArea(el.boundary));
  const thickness = type?.thickness ?? 0.2;
  return { area, perimeter: polygonPerimeter(el.boundary), thickness, volume: area * thickness };
}

export function columnQuantities(c) {
  const height = c.topZ - c.baseZ;
  return { height, volume: c.w * c.dd * height };
}
