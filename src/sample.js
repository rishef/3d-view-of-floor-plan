// A small two-storey house used as the starting project.

import { defaultTypes } from './core/template.js';
import { DEFAULT_SITE } from './core/site.js';

export function sampleProject() {
  const elements = [];
  let n = 0;
  const id = (prefix) => `${prefix}-s${++n}`;
  const P = ([x, y]) => ({ x, y });

  const L1 = { id: 'lvl-1', category: 'Level', name: 'Level 1', elevation: 0 };
  const L2 = { id: 'lvl-2', category: 'Level', name: 'Level 2', elevation: 3.2 };
  const RF = { id: 'lvl-roof', category: 'Level', name: 'Roof', elevation: 6.2 };
  elements.push(L1, L2, RF);

  const wall = (a, b, typeId, level, top) => {
    const w = { id: id('w'), category: 'Wall', typeId, levelId: level.id, baseOffset: 0, topLevelId: top?.id ?? null, topOffset: 0, height: 3, a: P(a), b: P(b), mark: '', comments: '' };
    elements.push(w);
    return w;
  };
  let doorNo = 0, winNo = 0;
  const door = (host, t, typeId, flipFacing = false, flipHand = false) =>
    elements.push({ id: id('d'), category: 'Door', typeId, hostId: host.id, t, flipFacing, flipHand, mark: `D${String(++doorNo).padStart(2, '0')}`, comments: '' });
  const win = (host, t, typeId, sill = 0.9) =>
    elements.push({ id: id('wn'), category: 'Window', typeId, hostId: host.id, t, sill, mark: `W${String(++winNo).padStart(2, '0')}`, comments: '' });
  const floor = (level, boundary, typeId = 'ft-generic-200', offset = 0) =>
    elements.push({ id: id('f'), category: 'Floor', typeId, levelId: level.id, offset, boundary: boundary.map(P), mark: '', comments: '' });
  const room = (level, x, y, number, name) =>
    elements.push({ id: id('r'), category: 'Room', levelId: level.id, x, y, number, name, department: '', comments: '' });
  const grid = (a, b, name) => elements.push({ id: id('g'), category: 'Grid', a: P(a), b: P(b), name });

  // Grids
  grid([0, 10], [0, -5], '1');
  grid([7, 10], [7, -5], '2');
  grid([12, 10], [12, -5], '3');
  grid([-2, 8], [14, 8], 'A');
  grid([-2, 0], [14, 0], 'B');

  // ---- Level 1 ----------------------------------------------------------------
  const EXT = 'wt-ext-300', INT = 'wt-int-120';
  const s1 = wall([0, 0], [12, 0], EXT, L1, L2);
  const e1 = wall([12, 0], [12, 8], EXT, L1, L2);
  const n1 = wall([12, 8], [0, 8], EXT, L1, L2);
  const w1 = wall([0, 8], [0, 0], EXT, L1, L2);
  const i1 = wall([7, 0], [7, 8], INT, L1, L2);
  const i2 = wall([7, 4], [12, 4], INT, L1, L2);

  door(s1, 3.5, 'dt-single-1000');
  door(i1, 2.0, 'dt-single-900', true);
  door(i1, 6.4, 'dt-single-900', true, true);
  win(s1, 1.5, 'wnt-fixed-1200');
  win(s1, 9.5, 'wnt-fixed-1800');
  win(e1, 2.0, 'wnt-fixed-1200');
  win(e1, 6.0, 'wnt-fixed-1200');
  win(n1, 2.5, 'wnt-fixed-1200');
  win(n1, 6.5, 'wnt-fixed-1800');
  win(n1, 9.5, 'wnt-fixed-1200');
  win(w1, 4.0, 'wnt-fixed-1800');

  floor(L1, [[-0.15, -0.15], [12.15, -0.15], [12.15, 8.15], [-0.15, 8.15]]);
  floor(L1, [[-0.15, -3], [7, -3], [7, -0.15], [-0.15, -0.15]]);
  room(L1, 3.5, 4.2, '101', 'Living / Dining');
  room(L1, 9.5, 2.0, '102', 'Bedroom 1');
  room(L1, 9.5, 6.0, '103', 'Bedroom 2');

  elements.push(
    { id: id('c'), category: 'Column', typeId: 'ct-concrete-300', levelId: L1.id, topLevelId: L2.id, baseOffset: 0, height: 3, x: 0, y: -2.85, rotation: 0, mark: 'C1', comments: '' },
    { id: id('c'), category: 'Column', typeId: 'ct-concrete-300', levelId: L1.id, topLevelId: L2.id, baseOffset: 0, height: 3, x: 6.85, y: -2.85, rotation: 0, mark: 'C2', comments: '' },
  );

  // ---- Level 2 ----------------------------------------------------------------
  const s2 = wall([0, 0], [12, 0], EXT, L2, RF);
  const e2 = wall([12, 0], [12, 8], EXT, L2, RF);
  const n2 = wall([12, 8], [0, 8], EXT, L2, RF);
  const w2 = wall([0, 8], [0, 0], EXT, L2, RF);
  const i3 = wall([6, 0], [6, 8], INT, L2, RF);

  door(s2, 3.0, 'dt-double-1800');
  door(i3, 4.0, 'dt-single-900', true);
  win(s2, 9.0, 'wnt-fixed-1800');
  win(e2, 4.0, 'wnt-fixed-1800');
  win(n2, 3.0, 'wnt-fixed-1200');
  win(n2, 9.0, 'wnt-fixed-1200');
  win(w2, 4.0, 'wnt-casement-600', 1.0);

  floor(L2, [[-0.15, -3], [7, -3], [7, -0.15], [12.15, -0.15], [12.15, 8.15], [-0.15, 8.15]]);
  room(L2, 3.0, 4.0, '201', 'Studio');
  room(L2, 9.0, 4.0, '202', 'Main Bedroom');

  // ---- Roof -------------------------------------------------------------------
  floor(RF, [[-0.6, -0.6], [12.6, -0.6], [12.6, 8.6], [-0.6, 8.6]], 'ft-roof-250', 0.25);

  // ---- Site context ---------------------------------------------------------------
  elements.push(
    { id: id('ctx'), category: 'Context', name: 'Apartment block', bearing: 90, distance: 9, width: 22, depth: 14, height: 24 },
    { id: id('ctx'), category: 'Context', name: 'Terrace houses', bearing: 200, distance: 12, width: 18, depth: 10, height: 8 },
  );

  return { format: 'keystone-bim', version: 1, name: 'Sample House', site: { ...DEFAULT_SITE }, types: defaultTypes(), elements };
}
