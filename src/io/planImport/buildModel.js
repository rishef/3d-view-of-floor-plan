// Creates walls, doors, windows, rooms, a floor slab and a roof from a cleaned import result.

import { BimDocument } from '../../core/document.js';
import { regenerate } from '../../core/regen.js';
import { outerBoundary } from '../../core/rooms.js';
import { offsetLeft, polygonArea, interiorPoint, copyPt } from '../../core/geom.js';

const mm = (m) => Math.round(m * 1000);

function clusterThicknesses(walls) {
  const values = walls.map((w) => Math.round(w.t * 100) / 100).sort((a, b) => a - b);
  const clusters = [];
  for (const v of values) {
    const last = clusters[clusters.length - 1];
    if (last && v - last.max <= 0.03) { last.items.push(v); last.max = v; } else clusters.push({ items: [v], max: v });
  }
  return clusters.map((c) => c.items[c.items.length >> 1]);
}

function wallTypeFor(doc, t, clusterReps, created) {
  const rep = clusterReps.reduce((best, r) => (Math.abs(r - t) < Math.abs(best - t) ? r : best), clusterReps[0]);
  const existing = doc.typesOf('Wall').find((ty) => Math.abs(ty.thickness - rep) <= 0.006);
  if (existing) return existing.id;
  const key = `w${rep}`;
  if (!created.has(key)) {
    const exterior = rep >= 0.18;
    created.set(key, doc.addType({
      category: 'Wall', name: `Imported Wall ${mm(rep)}`, thickness: rep,
      function: exterior ? 'Exterior' : 'Interior', material: exterior ? 'Brick' : 'Block / Plaster',
      color: exterior ? '#c28466' : '#e2ddd3',
    }).id);
  }
  return created.get(key);
}

function openingTypeFor(doc, kind, width, created) {
  const w = Math.round(width * 20) / 20; // 50 mm steps
  const existing = doc.typesOf(kind).find((ty) => Math.abs(ty.width - w) <= 0.03);
  if (existing) return existing.id;
  const key = `${kind}${w}`;
  if (!created.has(key)) {
    const type = kind === 'Door'
      ? { category: 'Door', name: `Imported Door ${mm(w)} x 2100`, width: w, height: 2.1, leaves: w >= 1.3 ? 2 : 1, glass: false, material: 'Wood', color: '#8a5a3b' }
      : { category: 'Window', name: `Imported Window ${mm(w)} x 1500`, width: w, height: 1.5, defaultSill: 0.9, material: 'Aluminium', color: '#3f454c' };
    created.set(key, doc.addType(type).id);
  }
  return created.get(key);
}

/**
 * result: { walls: [{ a, b, t }], openings: [{ wall, u, width, kind }] } in metres.
 * opts: { replace, name, levelId, heightMode: 'next' | 'fixed', height, floor, roof, rooms }
 */
export function applyImport(app, result, opts) {
  if (opts.replace) {
    const keep = app.doc.byCategory('Context').map((e) => structuredClone(e));
    const data = BimDocument.blank();
    data.name = opts.name || 'Imported Plan';
    data.site = { ...app.doc.site };
    data.elements.push(...keep);
    app.loadProject(data);
  }
  const doc = app.doc;
  const levelId = opts.replace || !doc.get(opts.levelId) ? doc.levels()[0].id : opts.levelId;
  const summary = { walls: 0, doors: 0, windows: 0, rooms: 0, floor: false, roof: false };

  doc.transact('Import Floor Plan', () => {
    const level = doc.get(levelId);
    let above = app.levelAbove(levelId);
    const reps = clusterThicknesses(result.walls);
    const created = new Map();
    const wallIds = result.walls.map((w) => {
      const el = doc.add({
        category: 'Wall', typeId: wallTypeFor(doc, w.t, reps, created), levelId, baseOffset: 0,
        topLevelId: opts.heightMode === 'next' && above ? above.id : null, topOffset: 0, height: opts.height ?? 3,
        a: copyPt(w.a), b: copyPt(w.b), mark: '', comments: 'Imported',
      });
      summary.walls++;
      return el.id;
    });
    for (const o of result.openings) {
      const el = { category: o.kind, typeId: openingTypeFor(doc, o.kind, o.width, created), hostId: wallIds[o.wall], t: o.u, mark: app.nextMark(o.kind), comments: 'Imported' };
      if (o.kind === 'Window') el.sill = 0.9;
      else Object.assign(el, { flipFacing: false, flipHand: false });
      doc.add(el);
      summary[o.kind === 'Door' ? 'doors' : 'windows']++;
    }

    // Derived elements need the regenerated wall network.
    const model = regenerate(doc);
    const graph = model.graphFor(levelId);
    const wallTop = Math.max(0.1, ...[...model.walls.values()].filter((f) => f.wall.levelId === levelId).map((f) => f.topZ - level.elevation));

    if (opts.rooms) {
      for (const face of graph.faces) {
        if (face.area < 2) continue;
        const poly = face.loop.map((l) => l.p);
        const p = interiorPoint(poly);
        doc.add({ category: 'Room', levelId, x: p.x, y: p.y, number: app.nextRoomNumber(levelId), name: 'Room', department: '', comments: '' });
        summary.rooms++;
      }
    }

    let outline = null;
    const outer = graph.faces.filter((f) => f.area < -1e-6).sort((p, q) => p.area - q.area)[0];
    if (outer) {
      const seg = outer.loop.find((l) => l.seg !== undefined)?.seg;
      if (seg !== undefined) outline = outerBoundary(graph, graph.segs[seg].id);
    }
    if (outline && Math.abs(polygonArea(outline)) > 1) {
      if (polygonArea(outline) < 0) outline.reverse();
      const floorType = doc.typesOf('Floor').find((t) => !t.roof) ?? doc.typesOf('Floor')[0];
      if (opts.floor && floorType) {
        doc.add({ category: 'Floor', typeId: floorType.id, levelId, offset: 0, boundary: outline.map(copyPt), mark: '', comments: 'Imported' });
        summary.floor = true;
      }
      const roofType = doc.typesOf('Floor').find((t) => t.roof) ?? floorType;
      if (opts.roof && roofType) {
        if (!above || opts.heightMode === 'fixed') {
          above = doc.levels().find((l) => Math.abs(l.elevation - (level.elevation + wallTop)) < 0.01)
            ?? doc.add({ category: 'Level', name: 'Roof', elevation: +(level.elevation + wallTop).toFixed(3) });
        }
        const overhang = offsetLeft(outline, outline.map(() => -0.3));
        doc.add({ category: 'Floor', typeId: roofType.id, levelId: above.id, offset: roofType.thickness ?? 0.25, boundary: overhang.map(copyPt), mark: '', comments: 'Imported roof' });
        summary.roof = true;
      }
    }
  });

  app.clearSelection();
  app.setActiveLevel(levelId);
  app.setViewMode('split');
  requestAnimationFrame(() => {
    app.planView.fit();
    app.view3d.fit();
  });
  return summary;
}
