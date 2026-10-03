// Floor-plan graphics and hit-testing. Everything here reads the regenerated model.

import { wallFootprint, wallPieces, wallPoint, columnCorners } from '../core/regen.js';
import { add, sub, mul, dot, norm, projectOnSegment, distToSegment, pointInPolygon, distToPolygonEdges, bounds } from '../core/geom.js';

export const COLORS = {
  bg: '#ffffff',
  ink: '#22262b',
  sel: '#0a6cff',
  selFill: 'rgba(10, 108, 255, 0.20)',
  hover: '#3b8cff',
  underlay: '#c5cbd1',
  floorFill: 'rgba(110, 120, 130, 0.07)',
  floorLine: '#9aa3ab',
  roomFill: 'rgba(64, 140, 255, 0.045)',
  warn: '#d6363c',
  grid: '#5f6b78',
};

const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

/** What the active floor plan shows: elements cut by (or sitting on) its level. */
export function planVisibility(app) {
  const { doc, model } = app;
  const level = app.activeLevel;
  const elev = level?.elevation ?? 0;
  const cutZ = elev + app.viewSettings.cutHeight;
  const walls = [...model.walls.values()].filter((f) => f.baseZ <= cutZ + 1e-6 && f.topZ > cutZ);
  const wallIds = new Set(walls.map((f) => f.id));
  const below = level ? app.levelBelow(level.id) : null;
  return {
    level,
    cutZ,
    walls,
    openings: [...model.openings.values()].filter((o) => wallIds.has(o.host.id)),
    floors: doc.byCategory('Floor').filter((e) => e.levelId === level?.id),
    rooms: doc.byCategory('Room').filter((e) => e.levelId === level?.id),
    columns: [...model.columns.values()].filter((c) => c.baseZ <= cutZ + 1e-6 && c.topZ > cutZ),
    grids: doc.byCategory('Grid'),
    context: [...model.context.values()],
    drawing: app.underlays.get(level?.id) ?? null,
    underlay: below && app.viewSettings.underlay
      ? [...model.walls.values()].filter((f) => f.wall.levelId === below.id && !wallIds.has(f.id))
      : [],
  };
}

function tracePoly(ctx, view, pts, begin = true) {
  if (begin) ctx.beginPath();
  pts.forEach((p, i) => {
    const s = view.toScreen(p);
    if (i) ctx.lineTo(s.x, s.y);
    else ctx.moveTo(s.x, s.y);
  });
  ctx.closePath();
}

function line(ctx, p, q) {
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(q.x, q.y);
  ctx.stroke();
}

export function drawModel(ctx, view, app, vis) {
  const { model } = app;
  ctx.save();
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';

  if (vis.drawing && app.viewSettings.showDrawing !== false) drawImportedDrawing(ctx, view, vis.drawing);

  // Nearby buildings (site context massing)
  for (const c of vis.context) drawContext(ctx, view, c, model.footprint.length > 0);

  // Floors: light tone + thin boundary
  for (const fl of vis.floors) {
    if (fl.boundary.length < 3) continue;
    tracePoly(ctx, view, fl.boundary);
    ctx.fillStyle = COLORS.floorFill;
    ctx.fill();
    ctx.strokeStyle = COLORS.floorLine;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Room interior tint
  for (const r of vis.rooms) {
    const reg = model.rooms.get(r.id);
    if (!reg) continue;
    ctx.beginPath();
    tracePoly(ctx, view, reg.outer, false);
    reg.holes.forEach((h) => tracePoly(ctx, view, h, false));
    ctx.fillStyle = app.selection.has(r.id) ? 'rgba(10,108,255,0.12)' : COLORS.roomFill;
    ctx.fill('evenodd');
  }

  // Underlay: walls of the level below, halftone
  ctx.strokeStyle = COLORS.underlay;
  ctx.lineWidth = 1;
  for (const f of vis.underlay) {
    tracePoly(ctx, view, wallFootprint(f));
    ctx.stroke();
  }

  // Cut walls. Stroke every piece, then fill every piece: fills hide the strokes that fall
  // inside neighbouring walls, leaving one clean outline around joined walls.
  const pieces = vis.walls.map((f) => ({
    f,
    polys: wallPieces(f, f.openings.filter((o) => o.valid).map((o) => ({ u0: o.u0, u1: o.u1 }))),
  }));
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 2.4;
  for (const { polys } of pieces) for (const p of polys) { tracePoly(ctx, view, p); ctx.stroke(); }
  for (const { f, polys } of pieces) {
    ctx.fillStyle = f.type?.color ?? '#cfcac1';
    for (const p of polys) { tracePoly(ctx, view, p); ctx.fill(); }
  }

  // Doors & windows
  for (const o of vis.openings) drawOpening(ctx, view, o, o.valid ? COLORS.ink : COLORS.warn);

  // Columns
  for (const c of vis.columns) {
    tracePoly(ctx, view, columnCorners(c));
    ctx.fillStyle = '#6f747a';
    ctx.fill();
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // Grids
  for (const g of vis.grids) drawGrid(ctx, view, g, COLORS.grid);

  // Room tags
  for (const r of vis.rooms) drawRoomTag(ctx, view, r, model.rooms.get(r.id));

  // Prehighlight & selection (only for elements this plan actually shows)
  const shown = new Set([
    ...vis.context.map((c) => c.id),
    ...vis.walls.map((f) => f.id), ...vis.openings.map((o) => o.id), ...vis.floors.map((f) => f.id),
    ...vis.rooms.map((r) => r.id), ...vis.columns.map((c) => c.id), ...vis.grids.map((g) => g.id),
  ]);
  if (app.hoverId && shown.has(app.hoverId) && !app.selection.has(app.hoverId)) highlight(ctx, view, app, app.hoverId, 'hover');
  for (const id of app.selection) if (shown.has(id)) highlight(ctx, view, app, id, 'sel');
  if (app.selection.size === 1 && app.toolName === 'select') {
    for (const g of gripsFor(app, [...app.selection][0])) drawGrip(ctx, view.toScreen(g.p));
  }
  ctx.restore();
}

function drawImportedDrawing(ctx, view, d) {
  ctx.save();
  ctx.globalAlpha = d.opacity ?? 0.35;
  if (d.kind === 'image') {
    const tl = view.toScreen({ x: d.x, y: d.y });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(d.image, tl.x, tl.y, d.w * view.scale, d.h * view.scale);
  } else {
    ctx.strokeStyle = '#6b7684';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const sg of d.segs) {
      const a = view.toScreen(sg.a), b = view.toScreen(sg.b);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

let hatchPattern = null;
function hatch(ctx) {
  if (!hatchPattern) {
    const c = document.createElement('canvas');
    c.width = c.height = 10;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(95,107,120,0.45)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, 10); g.lineTo(10, 0);
    g.stroke();
    hatchPattern = ctx.createPattern(c, 'repeat');
  }
  return hatchPattern;
}

function drawContext(ctx, view, c, showGap) {
  ctx.save();
  tracePoly(ctx, view, c.corners);
  ctx.fillStyle = 'rgba(150,158,168,0.18)';
  ctx.fill();
  ctx.fillStyle = hatch(ctx);
  ctx.fill();
  ctx.strokeStyle = '#6f7a86';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  const s = view.toScreen(c.center);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#3d4650';
  ctx.font = `600 12px ${FONT}`;
  ctx.fillText(c.el.name || 'Nearby building', s.x, s.y - 8);
  ctx.font = `11px ${FONT}`;
  ctx.fillText(`H ${(+c.height.toFixed(1))} m`, s.x, s.y + 8);
  if (showGap && (c.el.distance ?? 0) > 0.05) {
    const face = sub(c.center, mul(c.u, c.depth / 2));
    const ours = sub(face, mul(c.u, c.el.distance));
    const a = view.toScreen(ours), b = view.toScreen(face);
    ctx.strokeStyle = '#8a6d1f';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    line(ctx, a, b);
    ctx.setLineDash([]);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    ctx.font = `600 11px ${FONT}`;
    const text = `${(+c.el.distance.toFixed(2))} m`;
    const tw = ctx.measureText(text).width + 8;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(m.x - tw / 2, m.y - 8, tw, 16);
    ctx.fillStyle = '#8a6d1f';
    ctx.fillText(text, m.x, m.y);
  }
  ctx.restore();
}

/** North arrow in the top-right corner of the plan, rotated to true north. */
export function drawNorthArrow(ctx, w, site) {
  const cx = w - 34, cy = 74, r = 18;
  const ang = (-(site.planTopBearing || 0) * Math.PI) / 180; // clockwise from screen up
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();
  ctx.strokeStyle = '#9aa3ab';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, -r + 3);
  ctx.lineTo(6, 8);
  ctx.lineTo(0, 4);
  ctx.lineTo(-6, 8);
  ctx.closePath();
  ctx.fillStyle = '#22262b';
  ctx.fill();
  ctx.font = `700 10px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', 0, -r - 8);
  ctx.restore();
}

export function drawOpening(ctx, view, op, color = COLORS.ink) {
  const f = op.host;
  const h = f.t / 2;
  const S = (u, v) => view.toScreen(wallPoint(f, u, v));
  ctx.save();
  ctx.strokeStyle = color;
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  if (op.kind === 'Window') {
    line(ctx, S(op.u0, h), S(op.u1, h));
    line(ctx, S(op.u0, -h), S(op.u1, -h));
    const g = Math.min(h * 0.4, 0.035);
    line(ctx, S(op.u0, g), S(op.u1, g));
    line(ctx, S(op.u0, -g), S(op.u1, -g));
    line(ctx, S(op.u0, h), S(op.u0, -h));
    line(ctx, S(op.u1, h), S(op.u1, -h));
    ctx.restore();
    return;
  }
  const el = op.el ?? {};
  const side = el.flipFacing ? -1 : 1;
  const leaves = op.type?.leaves === 2 ? 2 : 1;
  const w = (op.u1 - op.u0) / leaves;
  const hinges = leaves === 2
    ? [[op.u0, op.u0 + w], [op.u1, op.u1 - w]]
    : el.flipHand ? [[op.u1, op.u0]] : [[op.u0, op.u1]];
  for (const [uh, uo] of hinges) {
    const H = wallPoint(f, uh, side * h);
    const sH = view.toScreen(H);
    const sL = view.toScreen(add(H, mul(f.n, side * w)));
    const sO = view.toScreen(wallPoint(f, uo, side * h));
    ctx.lineWidth = 1.8;
    line(ctx, sH, sL);
    ctx.lineWidth = 0.9;
    const a0 = Math.atan2(sL.y - sH.y, sL.x - sH.x);
    const a1 = Math.atan2(sO.y - sH.y, sO.x - sH.x);
    const turn = (sL.x - sH.x) * (sO.y - sH.y) - (sL.y - sH.y) * (sO.x - sH.x);
    ctx.beginPath();
    ctx.arc(sH.x, sH.y, w * view.scale, a0, a1, turn < 0);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawGrid(ctx, view, g, color) {
  const a = view.toScreen(g.a), b = view.toScreen(g.b);
  const d = norm(sub(b, a));
  const r = 11;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([18, 4, 3, 4]);
  line(ctx, a, b);
  ctx.setLineDash([]);
  ctx.font = `600 11px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [p, s] of [[a, -1], [b, 1]]) {
    const c = add(p, mul(d, s * r));
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(g.name, c.x, c.y + 0.5);
  }
  ctx.restore();
}

function drawRoomTag(ctx, view, room, region) {
  const s = view.toScreen({ x: room.x, y: room.y });
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = region ? COLORS.ink : COLORS.warn;
  ctx.font = `600 12px ${FONT}`;
  ctx.fillText(room.name || 'Room', s.x, s.y - 8);
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = region ? '#59616b' : COLORS.warn;
  ctx.fillText(`${room.number}  ·  ${region ? `${region.area.toFixed(2)} m²` : 'Not enclosed'}`, s.x, s.y + 8);
  ctx.restore();
}

function drawGrip(ctx, s) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = COLORS.sel;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();
}

/** Plan outline of any element, used for highlighting and box selection. */
export function elementShape(app, id) {
  const { doc, model } = app;
  const el = doc.get(id);
  if (!el) return null;
  switch (el.category) {
    case 'Wall': {
      const f = model.walls.get(id);
      return f ? { kind: 'poly', pts: wallFootprint(f) } : null;
    }
    case 'Door':
    case 'Window': {
      const o = model.openings.get(id);
      if (!o) return null;
      const h = o.host.t / 2 + 0.03;
      const pts = [wallPoint(o.host, o.u0, h), wallPoint(o.host, o.u1, h), wallPoint(o.host, o.u1, -h), wallPoint(o.host, o.u0, -h)];
      return { kind: 'poly', pts, opening: o };
    }
    case 'Floor':
      return el.boundary.length >= 3 ? { kind: 'poly', pts: el.boundary } : null;
    case 'Room': {
      const reg = model.rooms.get(id);
      return reg ? { kind: 'poly', pts: reg.outer, holes: reg.holes, anchor: { x: el.x, y: el.y } } : { kind: 'point', p: { x: el.x, y: el.y } };
    }
    case 'Column': {
      const c = model.columns.get(id);
      return c ? { kind: 'poly', pts: columnCorners(c) } : null;
    }
    case 'Grid':
      return { kind: 'line', a: el.a, b: el.b };
    case 'Context': {
      const c = model.context.get(id);
      return c ? { kind: 'poly', pts: c.corners } : null;
    }
    default:
      return null;
  }
}

function highlight(ctx, view, app, id, mode) {
  const shape = elementShape(app, id);
  if (!shape) return;
  const color = mode === 'sel' ? COLORS.sel : COLORS.hover;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = mode === 'sel' ? 2 : 1.6;
  if (mode === 'hover') ctx.setLineDash([6, 3]);
  if (shape.kind === 'poly') {
    ctx.beginPath();
    tracePoly(ctx, view, shape.pts, false);
    (shape.holes ?? []).forEach((h) => tracePoly(ctx, view, h, false));
    if (mode === 'sel') {
      ctx.fillStyle = COLORS.selFill;
      ctx.fill('evenodd');
    }
    ctx.stroke();
    if (shape.opening) drawOpening(ctx, view, shape.opening, color);
  } else if (shape.kind === 'line') {
    const el = app.doc.get(id);
    drawGrid(ctx, view, el, color);
  } else {
    const s = view.toScreen(shape.p);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Draggable control points for a single selected element. */
export function gripsFor(app, id) {
  const el = app.doc.get(id);
  if (!el) return [];
  if (el.category === 'Wall' || el.category === 'Grid') return [{ id, key: 'a', p: el.a }, { id, key: 'b', p: el.b }];
  if (el.category === 'Floor') return el.boundary.map((p, i) => ({ id, key: i, p }));
  return [];
}

/**
 * All elements under a plan point, best first. Priority mirrors Revit's prehighlight:
 * hosted elements beat their hosts, area elements are picked by their edges or tags.
 */
export function pickCandidates(app, view, p) {
  const vis = planVisibility(app);
  const tol = 6 / view.scale;
  const cands = [];
  const push = (id, d, prio) => { if (d <= tol) cands.push({ id, d, prio }); };

  for (const o of vis.openings) {
    const f = o.host;
    const mid = wallPoint(f, (o.u0 + o.u1) / 2);
    const q = sub(p, mid);
    const along = Math.abs(dot(q, f.d));
    const across = dot(q, f.n);
    const halfW = (o.u1 - o.u0) / 2;
    let d = Math.max(0, along - halfW, Math.abs(across) - f.t / 2);
    if (o.kind === 'Door') {
      const side = o.el.flipFacing ? -1 : 1;
      const reach = (o.u1 - o.u0) / (o.type?.leaves === 2 ? 2 : 1) + f.t / 2;
      if (along <= halfW && across * side >= 0 && across * side <= reach) d = 0;
    }
    push(o.id, d, 4);
  }
  for (const c of vis.columns) {
    const pts = columnCorners(c);
    push(c.id, pointInPolygon(p, pts) ? 0 : distToPolygonEdges(p, pts), 4);
  }
  for (const f of vis.walls) {
    push(f.id, Math.max(0, projectOnSegment(p, f.a, f.b).dist - f.t / 2), 3);
  }
  const ps = view.toScreen(p);
  for (const r of vis.rooms) {
    const s = view.toScreen({ x: r.x, y: r.y });
    if (Math.abs(ps.x - s.x) < 50 && Math.abs(ps.y - s.y) < 18) push(r.id, 0, 3);
  }
  for (const g of vis.grids) {
    const a = view.toScreen(g.a), b = view.toScreen(g.b);
    const d = norm(sub(b, a));
    const bubble = Math.min(Math.hypot(ps.x - (a.x - d.x * 11), ps.y - (a.y - d.y * 11)), Math.hypot(ps.x - (b.x + d.x * 11), ps.y - (b.y + d.y * 11)));
    push(g.id, Math.min(distToSegment(p, g.a, g.b), Math.max(0, bubble - 11) / view.scale), 2);
  }
  for (const fl of vis.floors) {
    if (fl.boundary.length >= 3) push(fl.id, distToPolygonEdges(p, fl.boundary), 1);
  }
  for (const c of vis.context) push(c.id, pointInPolygon(p, c.corners) ? 0 : distToPolygonEdges(p, c.corners), 1);
  cands.sort((x, y) => y.prio - x.prio || x.d - y.d);
  return cands.map((c) => c.id);
}

/** Box selection. Left-to-right selects elements fully inside, right-to-left anything touched. */
export function pickInRect(app, a, b, crossing) {
  const r = { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) };
  const vis = planVisibility(app);
  const ids = [
    ...vis.walls.map((f) => f.id), ...vis.openings.map((o) => o.id), ...vis.columns.map((c) => c.id),
    ...vis.floors.map((f) => f.id), ...vis.rooms.map((x) => x.id), ...vis.grids.map((g) => g.id),
    ...vis.context.map((c) => c.id),
  ];
  return ids.filter((id) => {
    const s = elementShape(app, id);
    if (!s) return false;
    const pts = s.kind === 'poly' ? s.pts : s.kind === 'line' ? [s.a, s.b] : [s.p];
    const bb = bounds(pts);
    const inside = bb.minX >= r.minX && bb.maxX <= r.maxX && bb.minY >= r.minY && bb.maxY <= r.maxY;
    if (inside) return true;
    return crossing && bb.minX <= r.maxX && bb.maxX >= r.minX && bb.minY <= r.maxY && bb.maxY >= r.minY;
  });
}
