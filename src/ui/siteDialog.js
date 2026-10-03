import { h } from './dom.js';
import { openModal, field } from './modal.js';
import { LOCATIONS } from '../core/site.js';
import { COMPASS8, compassLabel } from '../core/solar.js';

/** Site & context: location (for the sun), plan orientation, and nearby buildings. */
export function openSiteDialog(app) {
  const site = { ...app.doc.site };
  let rows = app.doc.byCategory('Context').map((e) => ({ id: e.id, name: e.name, bearing: e.bearing, distance: e.distance, width: e.width, depth: e.depth, height: e.height }));
  let nextName = rows.length + 1;

  const modal = openModal({ title: 'Site, Orientation & Nearby Buildings', className: 'site-modal' });
  const left = h('div', { class: 'site-col' });
  const right = h('div', { class: 'site-col wide' });
  modal.body.append(left, right);

  const numInput = (value, onChange, attrs = {}) => h('input', {
    type: 'number', value, ...attrs,
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v); },
  });

  // ---- compass preview ----
  const compass = h('div', { class: 'compass' });
  const drawCompass = () => {
    const t = site.planTopBearing || 0;
    const neighbours = rows.map((r) => {
      const a = (((r.bearing ?? 0) - t) * Math.PI) / 180;
      return `<circle cx="${60 + Math.sin(a) * 40}" cy="${60 - Math.cos(a) * 40}" r="5" fill="#8f99a3"/>`;
    }).join('');
    compass.innerHTML = `<svg viewBox="0 0 120 120" width="150" height="150" aria-label="Plan orientation">
      <rect x="44" y="44" width="32" height="32" rx="2" fill="#c28466" opacity="0.8"/>
      <text x="60" y="64" text-anchor="middle" font-size="8" fill="#fff" font-weight="600">PLAN</text>
      <path d="M60 30 L60 44" stroke="#1d2126" stroke-width="1.5"/><text x="60" y="27" text-anchor="middle" font-size="7" fill="#69727d">plan top</text>
      <circle cx="60" cy="60" r="52" fill="none" stroke="#c9ced5"/>
      ${neighbours}
      <g transform="rotate(${-t} 60 60)"><path d="M60 8 L65 20 L60 17 L55 20 Z" fill="#d6363c"/><text x="60" y="6" text-anchor="middle" font-size="8" font-weight="700" fill="#d6363c">N</text></g>
    </svg>`;
  };

  // ---- location ----
  const preset = h('select', {
    onchange: (e) => {
      const loc = LOCATIONS.find((l) => l[0] === e.target.value);
      if (!loc) return;
      [site.locationName, site.latitude, site.longitude, site.utcOffset] = loc;
      renderLeft();
    },
  }, h('option', { value: '' }, 'Custom…'), LOCATIONS.map(([name]) => h('option', { value: name, selected: name === site.locationName }, name)));

  function renderLeft() {
    const orient = h('select', { onchange: (e) => { site.planTopBearing = Number(e.target.value); renderLeft(); } },
      COMPASS8.map(([label, deg]) => h('option', { value: deg, selected: deg === site.planTopBearing }, `${label} (${deg}°)`)),
      COMPASS8.some(([, d]) => d === site.planTopBearing) ? null : h('option', { value: site.planTopBearing, selected: true }, `${site.planTopBearing}°`));
    left.replaceChildren(
      h('h4', {}, 'Location'),
      h('p', { class: 'muted' }, 'Sets the sun path. Pick a city or type coordinates.'),
      field('City', preset),
      field('Latitude', numInput(site.latitude, (v) => { site.latitude = v; site.locationName = 'Custom'; }, { step: 0.0001, min: -90, max: 90 }), '° N'),
      field('Longitude', numInput(site.longitude, (v) => { site.longitude = v; site.locationName = 'Custom'; }, { step: 0.0001, min: -180, max: 180 }), '° E'),
      field('Time zone', numInput(site.utcOffset, (v) => { site.utcOffset = v; }, { step: 0.5, min: -12, max: 14 }), 'h from UTC'),
      h('h4', {}, 'Orientation'),
      h('p', { class: 'muted' }, 'Which way does the top of your floor plan face?'),
      field('Plan top faces', orient),
      field('or exact bearing', numInput(site.planTopBearing, (v) => { site.planTopBearing = ((v % 360) + 360) % 360; drawCompass(); }, { step: 1 }), '°'),
      compass,
    );
    drawCompass();
  }

  // ---- nearby buildings ----
  function renderRight() {
    const table = h('table', { class: 'ctx-table' },
      h('thead', {}, h('tr', {}, ['Name', 'Direction from us', 'Clear distance', 'Width', 'Depth', 'Height', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((r, i) => {
        const dirLabel = h('span', { class: 'muted' }, compassLabel(r.bearing ?? 0));
        return h('tr', {},
          h('td', {}, h('input', { type: 'text', value: r.name ?? '', oninput: (e) => { r.name = e.target.value; } })),
          h('td', { class: 'dir' },
            h('select', { onchange: (e) => { r.bearing = Number(e.target.value); renderRight(); drawCompass(); } },
              COMPASS8.map(([label, deg]) => h('option', { value: deg, selected: deg === r.bearing }, label)),
              COMPASS8.some(([, d]) => d === r.bearing) ? null : h('option', { value: r.bearing, selected: true }, `${r.bearing}°`)),
            numInput(r.bearing ?? 0, (v) => { r.bearing = ((v % 360) + 360) % 360; dirLabel.textContent = compassLabel(r.bearing); drawCompass(); }, { step: 5, class: 'deg' }), '°'),
          ...['distance', 'width', 'depth', 'height'].map((k) => h('td', {}, numInput(r[k], (v) => { r[k] = Math.max(k === 'distance' ? 0 : 0.5, v); }, { step: 0.5, min: 0 }), ' m')),
          h('td', {}, h('button', { class: 'btn small danger', type: 'button', title: 'Remove', onclick: () => { rows.splice(i, 1); renderRight(); drawCompass(); } }, '×')));
      })));
    right.replaceChildren(
      h('h4', {}, 'Nearby buildings'),
      h('p', { class: 'muted' }, 'Direction is measured from your building (N = 0°, E = 90°). Clear distance is the gap between the two buildings; width is the side facing you. They cast shadows in the sun study and block sun to windows.'),
      rows.length ? table : h('p', { class: 'empty' }, 'No nearby buildings yet.'),
      h('button', {
        class: 'btn', type: 'button',
        onclick: () => {
          const used = new Set(rows.map((r) => r.bearing));
          const bearing = [0, 90, 180, 270, 45, 135, 225, 315].find((b) => !used.has(b)) ?? 0;
          rows.push({ name: `Building ${String.fromCharCode(64 + nextName++)}`, bearing, distance: 10, width: 20, depth: 15, height: 18 });
          renderRight();
          drawCompass();
        },
      }, '+ Add nearby building'));
  }

  modal.foot.append(
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, 'Cancel'),
    h('button', {
      class: 'btn primary', type: 'button',
      onclick: () => {
        const doc = app.doc;
        doc.transact('Edit Site & Nearby Buildings', () => {
          doc.site = { ...site };
          const keep = new Set(rows.map((r) => r.id).filter(Boolean));
          for (const e of doc.byCategory('Context')) if (!keep.has(e.id)) doc.remove(e.id);
          for (const r of rows) {
            const data = { name: r.name || 'Nearby building', bearing: r.bearing ?? 0, distance: r.distance ?? 10, width: r.width ?? 20, depth: r.depth ?? 15, height: r.height ?? 18 };
            const el = r.id && doc.get(r.id);
            if (el) Object.assign(el, data);
            else doc.add({ category: 'Context', ...data });
          }
        });
        modal.close();
        requestAnimationFrame(() => { app.planView.fit(); app.view3d.fit(); });
        app.status(`Site set to ${site.locationName || 'custom location'}; ${rows.length} nearby building(s). Turn on ☀ Sun study in the 3D view.`);
      },
    }, 'Apply'));

  renderLeft();
  renderRight();
}
