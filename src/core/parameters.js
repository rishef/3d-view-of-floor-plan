// Parameter definitions per category (instance and type), the BIM equivalent of a family's
// parameter list. Kinds: length (stored m, shown mm), number, text, select, bool, color,
// area, volume. `readonly` parameters are computed from the regenerated model.

import { add, mul, norm, sub } from './geom.js';
import { wallQuantities, floorQuantities, columnQuantities } from './regen.js';

const key = (k, fallback = '') => ({ get: (e) => e[k] ?? fallback, set: (e, v) => { e[k] = v; } });

const levelOptions = (app) => app.doc.levels().map((l) => [l.id, l.name]);
const topOptions = (app) => [['', 'Unconnected'], ...app.doc.levels().map((l) => [l.id, `Up to level: ${l.name}`])];
const levelName = (app, id) => app.doc.get(id)?.name ?? '—';

export function instanceParameters(app, category) {
  const { model } = app;
  switch (category) {
    case 'Wall': {
      const q = (e) => {
        const f = model.walls.get(e.id);
        return f ? wallQuantities(f) : null;
      };
      return [
        { label: 'Base Constraint', group: 'Constraints', kind: 'select', options: levelOptions, ...key('levelId') },
        { label: 'Base Offset', group: 'Constraints', kind: 'length', ...key('baseOffset', 0) },
        { label: 'Top Constraint', group: 'Constraints', kind: 'select', options: topOptions, get: (e) => e.topLevelId || '', set: (e, v) => { e.topLevelId = v || null; } },
        { label: 'Unconnected Height', group: 'Constraints', kind: 'length', min: 0.1, ...key('height', 3), disabled: (e) => !!e.topLevelId },
        { label: 'Top Offset', group: 'Constraints', kind: 'length', ...key('topOffset', 0), disabled: (e) => !e.topLevelId },
        {
          label: 'Length', group: 'Dimensions', kind: 'length', min: 0.05,
          get: (e) => model.walls.get(e.id)?.L ?? 0,
          set: (e, v) => { e.b = add(e.a, mul(norm(sub(e.b, e.a)), v)); },
        },
        { label: 'Height', group: 'Dimensions', kind: 'length', readonly: true, get: (e) => model.walls.get(e.id)?.H ?? 0 },
        { label: 'Area (net)', group: 'Dimensions', kind: 'area', readonly: true, get: (e) => q(e)?.netArea ?? 0 },
        { label: 'Volume', group: 'Dimensions', kind: 'volume', readonly: true, get: (e) => q(e)?.volume ?? 0 },
        { label: 'Mark', group: 'Identity Data', kind: 'text', ...key('mark') },
        { label: 'Comments', group: 'Identity Data', kind: 'text', ...key('comments') },
      ];
    }
    case 'Door':
    case 'Window': {
      const op = (e) => model.openings.get(e.id);
      const host = (e) => app.doc.get(e.hostId);
      const list = [
        { label: 'Level', group: 'Constraints', kind: 'text', readonly: true, get: (e) => levelName(app, host(e)?.levelId) },
        { label: 'Host', group: 'Constraints', kind: 'text', readonly: true, get: (e) => app.doc.type(host(e)?.typeId)?.name ?? '— (orphaned)' },
        { label: 'Offset Along Wall', group: 'Constraints', kind: 'length', ...key('t', 0) },
      ];
      if (category === 'Window') {
        list.push(
          { label: 'Sill Height', group: 'Constraints', kind: 'length', ...key('sill', 0.9) },
          { label: 'Head Height', group: 'Constraints', kind: 'length', readonly: true, get: (e) => op(e)?.z1 ?? 0 },
        );
      } else {
        list.push(
          { label: 'Head Height', group: 'Constraints', kind: 'length', readonly: true, get: (e) => op(e)?.z1 ?? 0 },
          { label: 'Flip Facing', group: 'Graphics', kind: 'bool', ...key('flipFacing', false) },
          { label: 'Flip Hand', group: 'Graphics', kind: 'bool', ...key('flipHand', false) },
        );
      }
      list.push(
        { label: 'Mark', group: 'Identity Data', kind: 'text', ...key('mark') },
        { label: 'Comments', group: 'Identity Data', kind: 'text', ...key('comments') },
      );
      return list;
    }
    case 'Floor': {
      const q = (e) => floorQuantities(e, app.doc.type(e.typeId));
      return [
        { label: 'Level', group: 'Constraints', kind: 'select', options: levelOptions, ...key('levelId') },
        { label: 'Height Offset From Level', group: 'Constraints', kind: 'length', ...key('offset', 0) },
        { label: 'Area', group: 'Dimensions', kind: 'area', readonly: true, get: (e) => q(e).area },
        { label: 'Perimeter', group: 'Dimensions', kind: 'length', readonly: true, get: (e) => q(e).perimeter },
        { label: 'Thickness', group: 'Dimensions', kind: 'length', readonly: true, get: (e) => q(e).thickness },
        { label: 'Volume', group: 'Dimensions', kind: 'volume', readonly: true, get: (e) => q(e).volume },
        { label: 'Mark', group: 'Identity Data', kind: 'text', ...key('mark') },
        { label: 'Comments', group: 'Identity Data', kind: 'text', ...key('comments') },
      ];
    }
    case 'Column': {
      const c = (e) => model.columns.get(e.id);
      return [
        { label: 'Base Level', group: 'Constraints', kind: 'select', options: levelOptions, ...key('levelId') },
        { label: 'Base Offset', group: 'Constraints', kind: 'length', ...key('baseOffset', 0) },
        { label: 'Top Level', group: 'Constraints', kind: 'select', options: topOptions, get: (e) => e.topLevelId || '', set: (e, v) => { e.topLevelId = v || null; } },
        { label: 'Unconnected Height', group: 'Constraints', kind: 'length', min: 0.1, ...key('height', 3), disabled: (e) => !!e.topLevelId },
        { label: 'Rotation (°)', group: 'Constraints', kind: 'number', ...key('rotation', 0) },
        { label: 'Length', group: 'Dimensions', kind: 'length', readonly: true, get: (e) => (c(e) ? columnQuantities(c(e)).height : 0) },
        { label: 'Volume', group: 'Dimensions', kind: 'volume', readonly: true, get: (e) => (c(e) ? columnQuantities(c(e)).volume : 0) },
        { label: 'Mark', group: 'Identity Data', kind: 'text', ...key('mark') },
        { label: 'Comments', group: 'Identity Data', kind: 'text', ...key('comments') },
      ];
    }
    case 'Room': {
      const r = (e) => model.rooms.get(e.id);
      return [
        { label: 'Number', group: 'Identity Data', kind: 'text', ...key('number') },
        { label: 'Name', group: 'Identity Data', kind: 'text', ...key('name') },
        { label: 'Department', group: 'Identity Data', kind: 'text', ...key('department') },
        { label: 'Comments', group: 'Identity Data', kind: 'text', ...key('comments') },
        { label: 'Level', group: 'Constraints', kind: 'text', readonly: true, get: (e) => levelName(app, e.levelId) },
        { label: 'Area', group: 'Dimensions', kind: 'area', readonly: true, get: (e) => r(e)?.area ?? 0 },
        { label: 'Perimeter', group: 'Dimensions', kind: 'length', readonly: true, get: (e) => r(e)?.perimeter ?? 0 },
        { label: 'Status', group: 'Dimensions', kind: 'text', readonly: true, get: (e) => (r(e) ? 'Enclosed' : 'Not enclosed') },
      ];
    }
    case 'Grid':
      return [{ label: 'Name', group: 'Identity Data', kind: 'text', ...key('name') }];
    case 'Context':
      return [
        { label: 'Name', group: 'Identity Data', kind: 'text', ...key('name') },
        { label: 'Direction (° from North)', group: 'Placement', kind: 'number', get: (e) => e.bearing ?? 0, set: (e, v) => { e.bearing = ((v % 360) + 360) % 360; } },
        { label: 'Clear Distance', group: 'Placement', kind: 'meters', min: 0, ...key('distance', 10) },
        { label: 'Width (facing us)', group: 'Dimensions', kind: 'meters', min: 0.5, ...key('width', 20) },
        { label: 'Depth', group: 'Dimensions', kind: 'meters', min: 0.5, ...key('depth', 15) },
        { label: 'Height', group: 'Dimensions', kind: 'meters', min: 0.5, ...key('height', 20) },
      ];
    case 'Level':
      return [
        { label: 'Name', group: 'Identity Data', kind: 'text', ...key('name') },
        { label: 'Elevation', group: 'Constraints', kind: 'length', ...key('elevation', 0) },
      ];
    default:
      return [];
  }
}

export function typeParameters(category) {
  const material = { label: 'Material', group: 'Materials and Finishes', kind: 'text', ...key('material') };
  const color = { label: 'Graphic Color', group: 'Materials and Finishes', kind: 'color', ...key('color', '#cccccc') };
  switch (category) {
    case 'Wall':
      return [
        { label: 'Thickness', group: 'Construction', kind: 'length', min: 0.02, ...key('thickness', 0.2) },
        { label: 'Function', group: 'Construction', kind: 'select', options: () => [['Exterior', 'Exterior'], ['Interior', 'Interior'], ['Core-shaft', 'Core-shaft'], ['Retaining', 'Retaining']], ...key('function', 'Interior') },
        material, color,
      ];
    case 'Door':
      return [
        { label: 'Width', group: 'Dimensions', kind: 'length', min: 0.3, ...key('width', 0.9) },
        { label: 'Height', group: 'Dimensions', kind: 'length', min: 0.5, ...key('height', 2.1) },
        { label: 'Leaves', group: 'Construction', kind: 'select', options: () => [['1', 'Single'], ['2', 'Double']], get: (t) => String(t.leaves ?? 1), set: (t, v) => { t.leaves = Number(v); } },
        { label: 'Glazed', group: 'Construction', kind: 'bool', ...key('glass', false) },
        material, color,
      ];
    case 'Window':
      return [
        { label: 'Width', group: 'Dimensions', kind: 'length', min: 0.2, ...key('width', 1.2) },
        { label: 'Height', group: 'Dimensions', kind: 'length', min: 0.2, ...key('height', 1.5) },
        { label: 'Default Sill Height', group: 'Dimensions', kind: 'length', ...key('defaultSill', 0.9) },
        material, color,
      ];
    case 'Floor':
      return [
        { label: 'Thickness', group: 'Construction', kind: 'length', min: 0.02, ...key('thickness', 0.2) },
        { label: 'Is Roof', group: 'Construction', kind: 'bool', ...key('roof', false) },
        material, color,
      ];
    case 'Column':
      return [
        { label: 'Width (b)', group: 'Dimensions', kind: 'length', min: 0.05, ...key('width', 0.4) },
        { label: 'Depth (h)', group: 'Dimensions', kind: 'length', min: 0.05, ...key('depth', 0.4) },
        material, color,
      ];
    default:
      return [];
  }
}

export function formatValue(kind, v) {
  if (v === null || v === undefined || v === '') return '';
  switch (kind) {
    case 'length': return String(Math.round(v * 1000));
    case 'meters': return String(Math.round(v * 100) / 100);
    case 'area': return `${Number(v).toFixed(2)} m²`;
    case 'volume': return `${Number(v).toFixed(3)} m³`;
    case 'number': return String(Math.round(v * 100) / 100);
    default: return String(v);
  }
}

/** Parses user input for a parameter; returns undefined when the input is invalid. */
export function parseValue(param, raw) {
  switch (param.kind) {
    case 'length': {
      const v = parseFloat(raw);
      if (!Number.isFinite(v)) return undefined;
      const m = v / 1000;
      return param.min !== undefined && m < param.min ? undefined : m;
    }
    case 'number': {
      const v = parseFloat(raw);
      return Number.isFinite(v) ? v : undefined;
    }
    case 'meters': {
      const v = parseFloat(raw);
      if (!Number.isFinite(v)) return undefined;
      return param.min !== undefined && v < param.min ? undefined : v;
    }
    case 'bool': return !!raw;
    default: return raw;
  }
}
