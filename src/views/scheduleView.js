import { h } from '../ui/dom.js';
import { wallQuantities, floorQuantities, columnQuantities } from '../core/regen.js';
import { downloadText } from '../io/fileio.js';
import { analyzeWindowSunlight } from '../analysis/sunlight.js';
import { formatClock, compassLabel } from '../core/solar.js';

const levelName = (app, id) => app.doc.get(id)?.name ?? '—';
const levelElev = (app, id) => app.doc.get(id)?.elevation ?? 0;

/**
 * Schedules are live tables over the model. Text cells marked `edit` write straight back
 * into the elements, the same two-way link Revit schedules have.
 */
export const SCHEDULES = {
  walls: {
    title: 'Wall Schedule',
    rows: (app) => [...app.model.walls.values()].map((f) => ({ id: f.id, el: f.wall, f, q: wallQuantities(f) })),
    cols: (app) => [
      { label: 'Mark', get: (r) => r.el.mark, edit: 'mark' },
      { label: 'Type', get: (r) => r.f.type?.name ?? '' },
      { label: 'Function', get: (r) => r.f.type?.function ?? '' },
      { label: 'Base Level', get: (r) => levelName(app, r.el.levelId), sort: (r) => levelElev(app, r.el.levelId) },
      { label: 'Length (m)', get: (r) => r.q.length, num: 2, total: true },
      { label: 'Height (m)', get: (r) => r.q.height, num: 2 },
      { label: 'Net Area (m²)', get: (r) => r.q.netArea, num: 2, total: true },
      { label: 'Volume (m³)', get: (r) => r.q.volume, num: 3, total: true },
      { label: 'Comments', get: (r) => r.el.comments, edit: 'comments' },
    ],
  },
  doors: {
    title: 'Door Schedule',
    rows: (app) => app.doc.byCategory('Door').map((el) => ({ id: el.id, el, op: app.model.openings.get(el.id), type: app.doc.type(el.typeId) })),
    cols: (app) => [
      { label: 'Mark', get: (r) => r.el.mark, edit: 'mark' },
      { label: 'Type', get: (r) => r.type?.name ?? '' },
      { label: 'Width (mm)', get: (r) => Math.round((r.type?.width ?? 0) * 1000), num: 0 },
      { label: 'Height (mm)', get: (r) => Math.round((r.type?.height ?? 0) * 1000), num: 0 },
      { label: 'Level', get: (r) => levelName(app, r.op?.host.wall.levelId), sort: (r) => levelElev(app, r.op?.host.wall.levelId) },
      { label: 'Material', get: (r) => r.type?.material ?? '' },
      { label: 'Status', get: (r) => (r.op?.valid ? 'OK' : 'Check placement') },
      { label: 'Comments', get: (r) => r.el.comments, edit: 'comments' },
    ],
    count: true,
  },
  windows: {
    title: 'Window Schedule',
    rows: (app) => app.doc.byCategory('Window').map((el) => ({ id: el.id, el, op: app.model.openings.get(el.id), type: app.doc.type(el.typeId) })),
    cols: (app) => [
      { label: 'Mark', get: (r) => r.el.mark, edit: 'mark' },
      { label: 'Type', get: (r) => r.type?.name ?? '' },
      { label: 'Width (mm)', get: (r) => Math.round((r.type?.width ?? 0) * 1000), num: 0 },
      { label: 'Height (mm)', get: (r) => Math.round((r.type?.height ?? 0) * 1000), num: 0 },
      { label: 'Sill (mm)', get: (r) => Math.round((r.el.sill ?? 0) * 1000), num: 0 },
      { label: 'Level', get: (r) => levelName(app, r.op?.host.wall.levelId), sort: (r) => levelElev(app, r.op?.host.wall.levelId) },
      { label: 'Glazed Area (m²)', get: (r) => (r.type?.width ?? 0) * (r.type?.height ?? 0), num: 2, total: true },
      { label: 'Comments', get: (r) => r.el.comments, edit: 'comments' },
    ],
    count: true,
  },
  rooms: {
    title: 'Room Schedule',
    rows: (app) => app.doc.byCategory('Room').map((el) => ({ id: el.id, el, reg: app.model.rooms.get(el.id) })),
    cols: (app) => [
      { label: 'Number', get: (r) => r.el.number, edit: 'number' },
      { label: 'Name', get: (r) => r.el.name, edit: 'name' },
      { label: 'Level', get: (r) => levelName(app, r.el.levelId), sort: (r) => levelElev(app, r.el.levelId) },
      { label: 'Department', get: (r) => r.el.department, edit: 'department' },
      { label: 'Area (m²)', get: (r) => r.reg?.area ?? null, num: 2, total: true },
      { label: 'Perimeter (m)', get: (r) => r.reg?.perimeter ?? null, num: 2 },
      { label: 'Status', get: (r) => (r.reg ? 'Enclosed' : 'Not enclosed') },
    ],
    count: true,
  },
  floors: {
    title: 'Floor Schedule',
    rows: (app) => app.doc.byCategory('Floor').map((el) => ({ id: el.id, el, type: app.doc.type(el.typeId), q: floorQuantities(el, app.doc.type(el.typeId)) })),
    cols: (app) => [
      { label: 'Type', get: (r) => r.type?.name ?? '' },
      { label: 'Level', get: (r) => levelName(app, r.el.levelId), sort: (r) => levelElev(app, r.el.levelId) },
      { label: 'Area (m²)', get: (r) => r.q.area, num: 2, total: true },
      { label: 'Perimeter (m)', get: (r) => r.q.perimeter, num: 2 },
      { label: 'Thickness (mm)', get: (r) => Math.round(r.q.thickness * 1000), num: 0 },
      { label: 'Volume (m³)', get: (r) => r.q.volume, num: 3, total: true },
      { label: 'Comments', get: (r) => r.el.comments, edit: 'comments' },
    ],
  },
  columns: {
    title: 'Structural Column Schedule',
    rows: (app) => [...app.model.columns.values()].map((c) => ({ id: c.id, el: c.el, c, q: columnQuantities(c) })),
    cols: (app) => [
      { label: 'Mark', get: (r) => r.el.mark, edit: 'mark' },
      { label: 'Type', get: (r) => r.c.type?.name ?? '' },
      { label: 'Base Level', get: (r) => levelName(app, r.el.levelId), sort: (r) => levelElev(app, r.el.levelId) },
      { label: 'Length (m)', get: (r) => r.q.height, num: 2, total: true },
      { label: 'Volume (m³)', get: (r) => r.q.volume, num: 3, total: true },
    ],
    count: true,
  },
  sunlight: {
    title: 'Window Sunlight',
    note: (app) => {
      const s = app.doc.site;
      const a = app.lastSunlight;
      return `${app.sun.date} at ${s.locationName || 'site'} · sunrise ${formatClock(a?.times.sunrise)} – sunset ${formatClock(a?.times.sunset)} · direct sun sampled every ${a?.step ?? 10} min, shaded by this building and nearby buildings · change the date in the 3D sun bar`;
    },
    rows: (app) => {
      const a = analyzeWindowSunlight(app, app.sun.date);
      app.lastSunlight = a;
      return [...a.results.values()].map((r) => ({ id: r.probe.id, el: app.doc.get(r.probe.id), r }));
    },
    cols: (app) => [
      { label: 'Mark', get: (x) => x.el?.mark, edit: 'mark' },
      { label: 'Level', get: (x) => levelName(app, x.r.probe.levelId), sort: (x) => levelElev(app, x.r.probe.levelId) },
      { label: 'Facing', get: (x) => `${compassLabel(x.r.probe.facing)} (${Math.round(x.r.probe.facing)}°)`, sort: (x) => x.r.probe.facing },
      { label: 'Size (mm)', get: (x) => `${Math.round(x.r.probe.width * 1000)} × ${Math.round(x.r.probe.height * 1000)}` },
      { label: 'Direct sun (h)', get: (x) => x.r.minutes / 60, num: 1 },
      { label: 'First sun', get: (x) => (x.r.first === null ? '—' : formatClock(x.r.first)), sort: (x) => x.r.first ?? 9999 },
      { label: 'Last sun', get: (x) => (x.r.last === null ? '—' : formatClock(x.r.last)), sort: (x) => x.r.last ?? -1 },
      { label: 'Sun now', get: (x) => (app.sun.enabled && app.view3d.sunlit.has(x.id) ? `☀ ${formatClock(app.sun.minutes)}` : '') },
    ],
    count: true,
  },
  context: {
    title: 'Nearby Buildings',
    rows: (app) => [...app.model.context.values()].map((c) => ({ id: c.id, el: c.el, c })),
    cols: () => [
      { label: 'Name', get: (r) => r.el.name, edit: 'name' },
      { label: 'Direction', get: (r) => `${compassLabel(r.el.bearing ?? 0)} (${Math.round(r.el.bearing ?? 0)}°)`, sort: (r) => r.el.bearing },
      { label: 'Clear distance (m)', get: (r) => r.el.distance, num: 1 },
      { label: 'Width (m)', get: (r) => r.c.width, num: 1 },
      { label: 'Depth (m)', get: (r) => r.c.depth, num: 1 },
      { label: 'Height (m)', get: (r) => r.c.height, num: 1 },
    ],
    count: true,
  },
  materials: {
    title: 'Material Takeoff',
    rows: (app) => {
      const acc = new Map();
      const addTo = (material, category, volume, area) => {
        const k = `${material}|${category}`;
        const r = acc.get(k) ?? { id: null, material, category, volume: 0, area: 0, count: 0 };
        r.volume += volume;
        r.area += area;
        r.count += 1;
        acc.set(k, r);
      };
      for (const f of app.model.walls.values()) {
        const q = wallQuantities(f);
        addTo(f.type?.material ?? '—', 'Walls', q.volume, q.netArea);
      }
      for (const el of app.doc.byCategory('Floor')) {
        const t = app.doc.type(el.typeId);
        const q = floorQuantities(el, t);
        addTo(t?.material ?? '—', 'Floors', q.volume, q.area);
      }
      for (const c of app.model.columns.values()) addTo(c.type?.material ?? '—', 'Structural Columns', columnQuantities(c).volume, 0);
      return [...acc.values()];
    },
    cols: () => [
      { label: 'Material', get: (r) => r.material },
      { label: 'Category', get: (r) => r.category },
      { label: 'Elements', get: (r) => r.count, num: 0, total: true },
      { label: 'Area (m²)', get: (r) => r.area, num: 2, total: true },
      { label: 'Volume (m³)', get: (r) => r.volume, num: 3, total: true },
    ],
  },
};

export class ScheduleView {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.sort = null;
    app.on('model', ({ reason }) => { if (reason !== 'live') this.render(); });
    app.on('view', () => this.render());
    app.on('selection', () => this.markSelection());
    app.on('sun', () => { if (app.scheduleKey === 'sunlight') this.render(); });
  }

  get visible() { return this.app.viewMode === 'schedule'; }

  data() {
    const def = SCHEDULES[this.app.scheduleKey] ?? SCHEDULES.walls;
    const cols = def.cols(this.app);
    let rows = def.rows(this.app);
    if (this.sort && this.sort.key === this.app.scheduleKey) {
      const c = cols[this.sort.col];
      const val = c.sort ?? c.get;
      rows = [...rows].sort((a, b) => {
        const x = val(a), y = val(b);
        const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true });
        return this.sort.dir * r;
      });
    }
    return { def, cols, rows };
  }

  render() {
    if (!this.visible) return;
    const { app } = this;
    const { def, cols, rows } = this.data();
    const fmt = (c, v) => (v === null || v === undefined || v === '' ? '' : c.num !== undefined ? Number(v).toFixed(c.num) : String(v));

    const select = h('select', { onchange: (e) => app.openSchedule(e.target.value) },
      Object.entries(SCHEDULES).map(([k, d]) => h('option', { value: k, selected: k === app.scheduleKey }, d.title)));
    const header = h('div', { class: 'sched-head' },
      h('div', { class: 'sched-title' }, def.title),
      select,
      h('span', { class: 'muted' }, `${rows.length} row${rows.length === 1 ? '' : 's'} · click a row to select the element · edit text cells in place`),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', type: 'button', onclick: () => this.exportCSV() }, 'Export CSV'));
    const note = def.note ? h('div', { class: 'sched-note' }, def.note(app)) : null;

    const thead = h('tr', {}, cols.map((c, i) => {
      const dir = this.sort?.key === app.scheduleKey && this.sort.col === i ? this.sort.dir : 0;
      return h('th', {
        class: c.num !== undefined ? 'num' : '',
        onclick: () => {
          this.sort = { key: app.scheduleKey, col: i, dir: dir === 1 ? -1 : 1 };
          this.render();
        },
      }, c.label, dir ? (dir > 0 ? ' ▲' : ' ▼') : '');
    }));

    const tbody = h('tbody');
    for (const r of rows) {
      const tr = h('tr', { 'data-id': r.id ?? '', class: r.id ? 'selectable' : '' });
      if (r.id) tr.addEventListener('click', (e) => { if (e.target.tagName !== 'INPUT') app.select([r.id], e.shiftKey || e.ctrlKey ? 'toggle' : 'replace'); });
      for (const c of cols) {
        const v = c.get(r);
        if (c.edit && r.id) {
          const id = r.id;
          tr.append(h('td', {}, h('input', {
            class: 'cell', value: v ?? '',
            onchange: (e) => app.doc.transact(`Edit ${c.label}`, () => { app.doc.get(id)[c.edit] = e.target.value; }),
            onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
          })));
        } else {
          tr.append(h('td', { class: c.num !== undefined ? 'num' : '' }, fmt(c, v)));
        }
      }
      tbody.append(tr);
    }

    const totals = h('tr', { class: 'totals' }, cols.map((c, i) => {
      if (i === 0) return h('td', {}, def.count ? `Total: ${rows.length}` : 'Grand total');
      if (!c.total) return h('td');
      return h('td', { class: 'num' }, fmt(c, rows.reduce((s, r) => s + (Number(c.get(r)) || 0), 0)));
    }));

    this.el.replaceChildren(header, note ?? '', h('div', { class: 'sched-scroll' }, h('table', { class: 'sched' }, h('thead', {}, thead), tbody, h('tfoot', {}, totals))));
    this.markSelection();
  }

  markSelection() {
    if (!this.visible) return;
    this.el.querySelectorAll('tr[data-id]').forEach((tr) => tr.classList.toggle('sel', this.app.selection.has(tr.dataset.id)));
  }

  exportCSV() {
    const { def, cols, rows } = this.data();
    const esc = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [cols.map((c) => esc(c.label)).join(',')];
    for (const r of rows) {
      lines.push(cols.map((c) => {
        const v = c.get(r);
        return esc(v === null || v === undefined ? '' : c.num !== undefined ? Number(v).toFixed(c.num) : String(v));
      }).join(','));
    }
    downloadText(lines.join('\n'), `${def.title.replace(/\W+/g, '-').toLowerCase()}.csv`, 'text/csv');
  }
}
