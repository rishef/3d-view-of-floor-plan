// Core engine tests. They run in the browser (open /tests/) with no dependencies.

import { polygonArea, offsetLeft } from '../src/core/geom.js';
import { BimDocument } from '../src/core/document.js';
import { regenerate, wallFootprint } from '../src/core/regen.js';
import { sampleProject } from '../src/sample.js';
import { moveElements } from '../src/core/edit.js';
import { buildIFC } from '../src/io/ifc.js';
import { sunPosition, sunTimes, localToUTC } from '../src/core/solar.js';
import { placeContext } from '../src/core/site.js';
import { drawSamplePlan, SAMPLE_WALLS, SAMPLE_OPENINGS } from '../src/io/planImport/samplePlan.js';
import { grayscale, otsu, loadPdf } from '../src/io/planImport/raster.js';
import { detectRaster, rasterGapClassifier } from '../src/io/planImport/detect.js';
import { cleanupWalls } from '../src/io/planImport/cleanup.js';
import { parseDXF, dxfWallCandidates, dxfGapClassifier } from '../src/io/planImport/dxf.js';
import { WalkController } from '../src/views/walk.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, msg = '') => { if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const close = (a, b, tol = 1e-6, msg = '') => { if (Math.abs(a - b) > tol) throw new Error(`${msg} expected ≈${b}, got ${a}`); };

const sample = () => {
  const doc = new BimDocument(sampleProject());
  return { doc, model: regenerate(doc) };
};
const roomArea = (doc, model, number) => model.rooms.get(doc.byCategory('Room').find((r) => r.number === number).id)?.area;

test('polygonArea is positive for counter-clockwise loops', () => {
  close(polygonArea([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }, { x: 0, y: 3 }]), 6);
  close(polygonArea([{ x: 0, y: 0 }, { x: 0, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 0 }]), -6);
});

test('offsetLeft shrinks a CCW square inward', () => {
  const sq = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
  close(polygonArea(offsetLeft(sq, [0.5, 0.5, 0.5, 0.5])), 9);
});

test('L-junctions are mitered to the outer and inner corners', () => {
  const { model } = sample();
  const south = [...model.walls.values()].find((f) => f.a.x === 0 && f.a.y === 0 && f.b.x === 12 && f.wall.levelId === 'lvl-1');
  const fp = wallFootprint(south);
  close(fp[0].x, 0.15, 1e-9, 'inner start x');
  close(fp[3].x, -0.15, 1e-9, 'outer start x');
  close(fp[3].y, -0.15, 1e-9, 'outer start y');
});

test('room areas are measured to wall finish faces', () => {
  const { doc, model } = sample();
  close(roomArea(doc, model, '101'), (7 - 0.15 - 0.06) * (8 - 0.3), 1e-6, 'living');
  close(roomArea(doc, model, '102'), (5 - 0.21) * (4 - 0.21), 1e-6, 'bedroom 1');
  eq(model.warnings.length, 0, 'sample warnings');
});

test('editing a type updates every instance and dependent rooms', () => {
  const { doc } = sample();
  doc.transact('thicken', () => { doc.type('wt-ext-300').thickness = 0.4; });
  const model = regenerate(doc);
  close(roomArea(doc, model, '101'), (7 - 0.2 - 0.06) * (8 - 0.4), 1e-6);
});

test('overlapping openings are flagged, not silently built', () => {
  const { doc } = sample();
  const host = doc.byCategory('Door')[0].hostId;
  doc.transact('clash', () => doc.add({ category: 'Window', typeId: 'wnt-fixed-1200', hostId: host, t: 3.5, sill: 0.9, mark: 'X' }));
  const model = regenerate(doc);
  const bad = [...model.openings.values()].filter((o) => !o.valid);
  eq(bad.length, 1, 'invalid openings');
  eq(model.warnings.length, 1, 'warnings');
});

test('moving a wall drags joined walls and updates the room', () => {
  const { doc } = sample();
  const east = doc.byCategory('Wall').find((w) => w.a.x === 12 && w.a.y === 0 && w.levelId === 'lvl-1');
  doc.transact('move', () => moveElements(doc, [east.id], { x: 1, y: 0 }));
  const model = regenerate(doc);
  const south = doc.byCategory('Wall').find((w) => w.a.x === 0 && w.a.y === 0 && w.levelId === 'lvl-1');
  close(south.b.x, 13, 1e-9, 'corner follows');
  const partition = doc.byCategory('Wall').find((w) => w.a.x === 7 && w.a.y === 4);
  close(partition.b.x, 13, 1e-9, 'T-junction follows');
  close(roomArea(doc, model, '102'), (6 - 0.21) * (4 - 0.21), 1e-6, 'bedroom grows');
});

test('deleting a wall deletes its hosted doors and windows', () => {
  const { doc } = sample();
  const host = doc.byCategory('Door')[0].hostId;
  const before = doc.hosted(host).length;
  doc.transact('delete', () => doc.remove(host));
  eq(before > 0, true);
  eq(doc.hosted(host).length, 0);
});

test('undo and redo restore exact project state', () => {
  const { doc } = sample();
  const json = JSON.stringify(doc.toJSON());
  doc.transact('add', () => doc.add({ category: 'Grid', a: { x: 0, y: 0 }, b: { x: 0, y: 5 }, name: 'Z' }));
  const after = JSON.stringify(doc.toJSON());
  doc.undo();
  eq(JSON.stringify(doc.toJSON()), json, 'undo');
  doc.redo();
  eq(JSON.stringify(doc.toJSON()), after, 'redo');
});

test('model edits outside a transaction are rejected', () => {
  const { doc } = sample();
  let threw = false;
  try { doc.add({ category: 'Grid', a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, name: 'Q' }); } catch { threw = true; }
  eq(threw, true);
});

test('IFC export is well-formed and every reference resolves', () => {
  const { doc, model } = sample();
  const ifc = buildIFC({ doc, model });
  const defined = new Set([...ifc.matchAll(/^#(\d+)=/gm)].map((m) => m[1]));
  const data = ifc.slice(ifc.indexOf('DATA;'));
  const missing = [...data.matchAll(/#(\d+)/g)].map((m) => m[1]).filter((id) => !defined.has(id));
  eq(missing.length, 0, 'dangling references');
  eq((ifc.match(/=IFCWALL\(/g) ?? []).length, 11, 'walls');
  eq((ifc.match(/=IFCOPENINGELEMENT\(/g) ?? []).length, 18, 'openings');
  eq((ifc.match(/=IFCSPACE\(/g) ?? []).length, 5, 'spaces');
  eq(ifc.includes("FILE_SCHEMA(('IFC4'));"), true, 'schema');
});

// ---- site & sun ------------------------------------------------------------------------------
test('sunrise and sunset match published times (Singapore, 21 Dec)', () => {
  const t = sunTimes('2026-12-21', 1.3521, 103.8198, 8);
  close(t.sunrise, 7 * 60 + 1, 4, 'sunrise');
  close(t.sunset, 19 * 60 + 4, 4, 'sunset');
});

test('solar noon altitude matches 90° − latitude + declination (London, 21 Jun)', () => {
  let best = -90;
  for (let m = 11 * 60; m <= 13 * 60; m += 2) best = Math.max(best, sunPosition(localToUTC('2026-06-21', m, 1), 51.5074, -0.1278).altitude);
  close(best, 90 - 51.5074 + 23.44, 0.7, 'noon altitude');
});

test('morning sun is in the east, afternoon sun in the west', () => {
  const am = sunPosition(localToUTC('2026-03-20', 9 * 60, 8), 1.35, 103.82).azimuth;
  const pm = sunPosition(localToUTC('2026-03-20', 16 * 60, 8), 1.35, 103.82).azimuth;
  eq(am > 45 && am < 135, true, `morning azimuth ${am}`);
  eq(pm > 225 && pm < 315, true, `afternoon azimuth ${pm}`);
});

test('nearby buildings are placed by direction and clear distance from our outer face', () => {
  const footprint = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 8 }, { x: 0, y: 8 }];
  const c = placeContext({ bearing: 90, distance: 10, width: 20, depth: 14, height: 24 }, footprint, { planTopBearing: 0 });
  close(c.center.x, 12 + 10 + 7, 1e-9, 'east');
  close(c.center.y, 4, 1e-9);
  const rotated = placeContext({ bearing: 90, distance: 10, width: 20, depth: 14 }, footprint, { planTopBearing: 90 });
  close(rotated.center.y, 8 + 10 + 7, 1e-9, 'plan top faces east → east is plan-up');
});

// ---- floor plan import -------------------------------------------------------------------------
function importRaster(canvas, ppm) {
  const { gray, w, h } = grayscale(canvas);
  const det = detectRaster(gray, w, h, { threshold: otsu(gray), mode: 'auto', minThickPx: 0.075 * ppm, maxThickPx: 0.45 * ppm, minLenPx: 0.4 * ppm, minWinPx: 0.4 * ppm });
  const toW = (p) => ({ x: p.x / ppm, y: (h - p.y) / ppm });
  const toPx = (p) => ({ x: p.x * ppm, y: h - p.y * ppm });
  const res = cleanupWalls(
    det.walls.map((x) => ({ a: toW(x.a), b: toW(x.b), t: x.t / ppm })),
    det.windows.map((x) => ({ center: toW(x.center), width: x.width / ppm, kind: 'Window' })),
    { minLen: 0.4, classify: rasterGapClassifier(det.bin, w, h, toPx, ppm) },
  );
  return { det, res };
}
const counts = (res) => ({ walls: res.walls.length, doors: res.openings.filter((o) => o.kind === 'Door').length, windows: res.openings.filter((o) => o.kind === 'Window').length });
const expected = { walls: SAMPLE_WALLS.length, doors: SAMPLE_OPENINGS.filter((o) => o[3] === 'Door').length, windows: SAMPLE_OPENINGS.filter((o) => o[3] === 'Window').length };

for (const style of ['filled', 'outlined']) {
  test(`image import finds every wall, door and window (${style} walls)`, () => {
    const { canvas, ppm } = drawSamplePlan({ style });
    const { det, res } = importRaster(canvas, ppm);
    eq(det.mode, style, 'auto-detected drawing style');
    eq(JSON.stringify(counts(res)), JSON.stringify(expected));
    close(Math.max(...res.walls.map((w) => w.t)), 0.23, 0.03, 'exterior wall thickness');
  });
}

/** The sample plan as a DXF in millimetres: wall face lines, glazing lines and door arcs on separate layers. */
function sampleDXF() {
  const out = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const line = (layer, a, b) => out.push('0', 'LINE', '8', layer, '10', a[0] * 1000, '20', a[1] * 1000, '11', b[0] * 1000, '21', b[1] * 1000);
  SAMPLE_WALLS.forEach(([a, b, t], i) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-d[1], d[0]];
    const at = (u, v) => [a[0] + d[0] * u + n[0] * v, a[1] + d[1] * u + n[1] * v];
    const cuts = SAMPLE_OPENINGS.filter((o) => o[0] === i).sort((p, q) => p[1] - q[1]);
    let s0 = -t / 2;
    for (const [, u0, u1, kind] of [...cuts, [i, L + t / 2, L + t / 2, null]]) {
      line('A-WALL', at(s0, t / 2), at(u0, t / 2));
      line('A-WALL', at(s0, -t / 2), at(u0, -t / 2));
      if (kind === 'Window') for (const v of [t / 2, t / 6, -t / 6, -t / 2]) line('A-GLAZ', at(u0, v), at(u1, v));
      if (kind === 'Door') {
        const c = at(u0, t / 2);
        out.push('0', 'ARC', '8', 'A-DOOR', '10', c[0] * 1000, '20', c[1] * 1000, '40', (u1 - u0) * 1000, '50', '0', '51', '90');
      }
      s0 = u1;
    }
  });
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n');
}

test('DXF import pairs double lines into walls and classifies openings', () => {
  const parsed = parseDXF(sampleDXF());
  eq(parsed.unitsToM, 0.001, 'units from $INSUNITS');
  const segs = parsed.segments.map((s) => ({ ...s, a: { x: s.a.x / 1000, y: s.a.y / 1000 }, b: { x: s.b.x / 1000, y: s.b.y / 1000 } }));
  const walls = dxfWallCandidates(segs.filter((s) => s.layer === 'A-WALL'), { minThick: 0.075, maxThick: 0.45, minLen: 0.4 });
  const res = cleanupWalls(walls, [], { minLen: 0.4, classify: dxfGapClassifier(segs) });
  eq(JSON.stringify(counts(res)), JSON.stringify(expected));
});

/** A one-page PDF drawing the sample walls as filled rectangles at 20 pt per metre. */
function samplePDF() {
  const k = 20, m = 30;
  let ops = '0 g\n';
  SAMPLE_WALLS.forEach(([a, b, t], i) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const cuts = SAMPLE_OPENINGS.filter((o) => o[0] === i).sort((p, q) => p[1] - q[1]);
    let s0 = -t / 2;
    for (const [, u0, u1] of [...cuts, [i, L + t / 2, L + t / 2]]) {
      const p = [a[0] + d[0] * s0, a[1] + d[1] * s0], q = [a[0] + d[0] * u0, a[1] + d[1] * u0];
      const x0 = Math.min(p[0], q[0]) - (d[0] ? 0 : t / 2), y0 = Math.min(p[1], q[1]) - (d[1] ? 0 : t / 2);
      const wv = Math.abs(q[0] - p[0]) + (d[0] ? 0 : t), hv = Math.abs(q[1] - p[1]) + (d[1] ? 0 : t);
      ops += `${(m + x0 * k).toFixed(2)} ${(m + y0 * k).toFixed(2)} ${(wv * k).toFixed(2)} ${(hv * k).toFixed(2)} re f\n`;
      s0 = u1;
    }
  });
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${14 * k + 2 * m} ${10 * k + 2 * m}] /Contents 4 0 R >>`,
    `<< /Length ${ops.length} >>\nstream\n${ops}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return { bytes: new TextEncoder().encode(pdf), pointsPerMetre: k, pageWidthPt: 14 * k + 2 * m };
}

test('PDF import renders the page and finds the walls', async () => {
  const { bytes, pointsPerMetre, pageWidthPt } = samplePDF();
  const { canvas } = await loadPdf(bytes.buffer);
  const ppm = (canvas.width / pageWidthPt) * pointsPerMetre;
  const { res } = importRaster(canvas, ppm);
  eq(res.walls.length, SAMPLE_WALLS.length, 'walls');
  eq(res.openings.length, SAMPLE_OPENINGS.length, 'openings (gaps)');
});

// ---- walkthrough ---------------------------------------------------------------------------
function walker() {
  const { doc, model } = sample();
  const app = { doc, model, selection: new Set(), activeLevelId: 'lvl-1', on() {}, emit() {}, setActiveLevel(id) { this.activeLevelId = id; } };
  const w = new WalkController(app, { version: 1 });
  w.levelId = 'lvl-1';
  return w;
}

test('walking into a wall stops at the wall face', () => {
  const w = walker();
  w.pos = { x: 3.5, y: 4 };
  w.moveBy({ x: 0, y: 10 });
  close(w.pos.y, 8 - 0.15 - 0.25, 0.01, 'stopped by the north wall');
});

test('door openings can be walked through, window openings cannot', () => {
  const w = walker();
  w.pos = { x: 3.5, y: 1 };
  w.moveBy({ x: 0, y: -3 });
  eq(w.pos.y < -1.5, true, `walked out of the front door (y=${w.pos.y.toFixed(2)})`);
  w.pos = { x: 1.5, y: 1 };
  w.moveBy({ x: 0, y: -3 });
  eq(w.pos.y > 0, true, `blocked at the window (y=${w.pos.y.toFixed(2)})`);
});

test('the auto tour enters by the front door and visits every room through doors', () => {
  const w = walker();
  w.pos = { x: 3.5, y: -3.35 };
  const legs = w.planTour();
  eq(legs.length, 2, 'one leg per level with rooms');
  eq(JSON.stringify(legs[0].wps.filter((p) => p.pause).map((p) => p.space.name)), JSON.stringify(['Living / Dining', 'Bedroom 1', 'Bedroom 2']));
  eq(legs[0].wps.some((p) => p.teleport), false, 'level 1 is toured on foot');
});

export async function run(log) {
  let passed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed += 1;
      log(true, t.name);
    } catch (err) {
      log(false, t.name, err.message);
    }
  }
  return { passed, total: tests.length };
}
