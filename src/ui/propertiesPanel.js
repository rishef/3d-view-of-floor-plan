import { h } from './dom.js';
import { instanceParameters, typeParameters, formatValue, parseValue } from '../core/parameters.js';
import { FAMILY_NAMES, CATEGORY_PLURAL } from '../core/template.js';
import { promptDialog } from './dialogs.js';

const UNITS = { length: 'mm', meters: 'm' };

/**
 * Revit's Properties palette: type selector, instance parameters grouped by category,
 * "Edit Type" for type parameters, and view properties when nothing is selected.
 */
export class PropertiesPanel {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.typeOpen = false;
    app.on('selection', () => {
      this.typeOpen = false;
      this.render();
    });
    app.on('tool', () => this.render());
    app.on('view', () => this.render());
    app.on('model', ({ reason }) => {
      if (reason === 'live' && this.el.contains(document.activeElement)) return;
      this.render();
    });
    this.render();
  }

  render() {
    const { app } = this;
    const scroll = this.body?.scrollTop ?? 0;
    this.el.replaceChildren();
    this.body = h('div', { class: 'panel-body' });
    this.el.append(h('div', { class: 'panel-title' }, 'Properties'), this.body);
    const sel = [...app.selection].map((id) => app.doc.get(id)).filter(Boolean);
    if (!sel.length) {
      if (app.tool.category) this.renderPlacement(app.tool.category);
      else this.renderViewProperties();
    } else {
      const cats = [...new Set(sel.map((e) => e.category))];
      if (cats.length > 1) this.renderMixed(sel, cats);
      else this.renderElements(sel, cats[0]);
    }
    this.body.scrollTop = scroll;
  }

  // ---- sections ----------------------------------------------------------------------
  renderPlacement(category) {
    const { app } = this;
    const typeId = app.typeFor(category);
    this.body.append(this.typeSelector(category, typeId, (id) => app.setTypeFor(category, id)));
    const type = app.doc.type(typeId);
    this.body.append(h('div', { class: 'phead' },
      h('span', {}, `New ${FAMILY_NAMES[category] ?? category}`),
      type ? h('button', { class: 'linkbtn', type: 'button', onclick: () => { this.typeOpen = !this.typeOpen; this.render(); } }, this.typeOpen ? 'Hide Type' : 'Edit Type') : null));
    if (type && this.typeOpen) this.renderTypeSection(type);
    this.body.append(h('p', { class: 'pnote' }, app.tool.hint));
  }

  renderElements(els, category) {
    const { app } = this;
    const types = app.doc.typesOf(category);
    const typeIds = [...new Set(els.map((e) => e.typeId))];
    if (types.length) {
      this.body.append(this.typeSelector(category, typeIds.length === 1 ? typeIds[0] : '', (id) => {
        const ids = els.map((e) => e.id);
        app.doc.transact('Change Type', () => ids.forEach((i) => { app.doc.get(i).typeId = id; }));
      }));
    }
    const singleType = typeIds.length === 1 ? app.doc.type(typeIds[0]) : null;
    this.body.append(h('div', { class: 'phead' },
      h('span', {}, `${CATEGORY_PLURAL[category] ?? category} (${els.length})`),
      singleType ? h('button', { class: 'linkbtn', type: 'button', onclick: () => { this.typeOpen = !this.typeOpen; this.render(); } }, this.typeOpen ? 'Hide Type' : 'Edit Type') : null));
    if (singleType && this.typeOpen) this.renderTypeSection(singleType);

    const ids = els.map((e) => e.id);
    this.renderGroups(instanceParameters(app, category), els, (param, value) => {
      app.doc.transact(`Modify ${param.label}`, () => ids.forEach((id) => {
        const el = app.doc.get(id);
        if (el) param.set(el, value);
      }));
    });
  }

  renderMixed(els, cats) {
    this.body.append(h('div', { class: 'phead' }, h('span', {}, `Multiple categories (${els.length})`)));
    const list = h('div', { class: 'filter-list' });
    for (const c of cats) {
      const n = els.filter((e) => e.category === c).length;
      list.append(h('button', {
        class: 'filter-item', type: 'button', title: `Keep only ${CATEGORY_PLURAL[c] ?? c} in the selection`,
        onclick: () => this.app.select(els.filter((e) => e.category === c).map((e) => e.id)),
      }, h('span', {}, CATEGORY_PLURAL[c] ?? c), h('span', { class: 'count' }, String(n))));
    }
    this.body.append(list, h('p', { class: 'pnote' }, 'Click a category to filter the selection, then edit its properties.'));
  }

  renderViewProperties() {
    const { app } = this;
    const level = app.activeLevel;
    const vs = app.viewSettings;
    const setting = (label, kind, k, extra = {}) => ({ label, kind, get: () => vs[k], set: (_, v) => app.setViewSetting(k, v), ...extra });

    this.body.append(h('div', { class: 'phead' }, h('span', {}, `Floor Plan: ${level?.name ?? '—'}`)));
    this.renderGroups([
      { ...setting('Cut Plane Height', 'length', 'cutHeight', { min: 0.1 }), group: 'View Range' },
      { ...setting('Underlay (level below)', 'bool', 'underlay'), group: 'Graphics' },
      { ...setting('Background Grid', 'bool', 'showGrid'), group: 'Graphics' },
    ], [{}], (p, v) => p.set(null, v));

    if (level) {
      const lid = level.id;
      this.renderGroups(instanceParameters(app, 'Level').map((p) => ({ ...p, group: 'Level' })), [level], (p, v) => {
        app.doc.transact(`Modify Level ${p.label}`, () => p.set(app.doc.get(lid), v));
      });
      this.body.append(h('div', { class: 'pactions' },
        h('button', { class: 'btn', type: 'button', onclick: () => app.addLevel() }, '+ New Level'),
        h('button', { class: 'btn danger', type: 'button', onclick: () => app.deleteLevel(lid) }, 'Delete Level')));
    }

    const drawing = level ? app.underlays.get(level.id) : null;
    if (drawing) {
      const lid = level.id;
      this.renderGroups([
        { ...setting('Show Imported Drawing', 'bool', 'showDrawing'), get: () => vs.showDrawing !== false, group: `Imported Drawing · ${drawing.name ?? ''}` },
        { label: 'Drawing Opacity (%)', kind: 'number', group: `Imported Drawing · ${drawing.name ?? ''}`, get: () => Math.round((drawing.opacity ?? 0.35) * 100), set: (_, v) => { drawing.opacity = Math.max(0.05, Math.min(1, v / 100)); app.emit('view'); } },
      ], [{}], (p, v) => p.set(null, v));
      this.body.append(h('div', { class: 'pactions' }, h('button', { class: 'btn', type: 'button', onclick: () => app.setUnderlay(lid, null) }, 'Remove Imported Drawing')));
    }

    const site = app.doc.site;
    this.body.append(h('div', { class: 'phead' }, h('span', {}, 'Site'), h('button', { class: 'linkbtn', type: 'button', onclick: () => app.openSiteDialog?.() }, 'Edit Site…')));
    this.renderGroups([
      { label: 'Location', group: 'Location', kind: 'text', readonly: true, get: () => `${site.locationName || 'Custom'} (${site.latitude.toFixed(2)}, ${site.longitude.toFixed(2)})` },
      { label: 'Plan Top Faces', group: 'Location', kind: 'text', readonly: true, get: () => `${site.planTopBearing}°` },
      { label: 'Nearby Buildings', group: 'Location', kind: 'text', readonly: true, get: () => String(app.doc.byCategory('Context').length) },
    ], [{}], () => {});

    this.body.append(h('div', { class: 'phead' }, h('span', {}, '{3D}')));
    this.renderGroups([
      { ...setting('Section Box (cut at plan)', 'bool', 'sectionBox'), group: 'Extents' },
      { ...setting('Shadows', 'bool', 'shadows'), group: 'Graphics' },
      { ...setting('Show Edges', 'bool', 'edges'), group: 'Graphics' },
    ], [{}], (p, v) => p.set(null, v));

    this.body.append(h('div', { class: 'phead' }, h('span', {}, 'Project')));
    this.renderGroups([{ label: 'Project Name', group: 'Project Information', kind: 'text', get: () => app.doc.name, set: () => {} }], [{}], (_, v) => {
      app.doc.transact('Rename Project', () => { app.doc.name = v || 'Untitled Project'; });
    });
  }

  renderTypeSection(type) {
    const { app } = this;
    const count = app.doc.instancesOfType(type.id).length;
    const tid = type.id;
    const box = h('div', { class: 'type-box' });
    box.append(h('div', { class: 'type-box-head' },
      h('div', {}, h('div', { class: 'type-box-title' }, 'Type Parameters'),
        h('div', { class: 'type-box-note' }, `Changes affect ${count} instance${count === 1 ? '' : 's'} of “${type.name}”`)),
      h('div', { class: 'type-box-actions' },
        h('button', { class: 'btn small', type: 'button', onclick: () => this.duplicateType(type) }, 'Duplicate…'),
        h('button', { class: 'btn small', type: 'button', onclick: () => this.renameType(type) }, 'Rename…'))));
    this.body.append(box);
    this.renderGroups(typeParameters(type.category), [type], (p, v) => {
      app.doc.transact(`Edit Type: ${type.name}`, () => p.set(app.doc.type(tid), v));
    }, box);
  }

  async duplicateType(type) {
    const { app } = this;
    const name = await promptDialog('Name for the new type', `${type.name} (2)`, { title: 'Duplicate type', ok: 'Duplicate' });
    if (!name) return;
    const ids = [...app.selection];
    const created = app.doc.transact('Duplicate Type', () => {
      const t = structuredClone(type);
      delete t.id;
      t.name = name;
      app.doc.addType(t);
      ids.forEach((id) => { const el = app.doc.get(id); if (el?.category === type.category) el.typeId = t.id; });
      return t;
    });
    if (!ids.length) app.setTypeFor(type.category, created.id);
    this.typeOpen = true;
    this.render();
  }

  async renameType(type) {
    const name = await promptDialog('New name for this type', type.name, { title: 'Rename type', ok: 'Rename' });
    if (!name || name === type.name) return;
    this.app.doc.transact('Rename Type', () => { this.app.doc.type(type.id).name = name; });
  }

  // ---- widgets ---------------------------------------------------------------------------
  typeSelector(category, currentId, onChange) {
    const types = this.app.doc.typesOf(category);
    const select = h('select', { class: 'type-select', onchange: (e) => e.target.value && onChange(e.target.value) });
    if (!currentId) select.append(h('option', { value: '' }, '<varies>'));
    for (const t of types) select.append(h('option', { value: t.id, selected: t.id === currentId }, t.name));
    return h('div', { class: 'type-selector' }, h('div', { class: 'family' }, FAMILY_NAMES[category] ?? category), select);
  }

  renderGroups(params, targets, onSet, container = this.body) {
    const groups = new Map();
    for (const p of params) {
      if (!groups.has(p.group)) groups.set(p.group, []);
      groups.get(p.group).push(p);
    }
    for (const [name, list] of groups) {
      const det = h('details', { class: 'pgroup', open: true }, h('summary', {}, name));
      for (const p of list) det.append(this.row(p, targets, onSet));
      container.append(det);
    }
  }

  row(param, targets, onSet) {
    const values = targets.map((t) => param.get(t));
    const same = values.every((v) => v === values[0]);
    const value = same ? values[0] : undefined;
    const disabled = !!param.readonly || targets.some((t) => param.disabled?.(t));
    const commit = (raw) => {
      const v = parseValue(param, raw);
      if (v === undefined) {
        this.app.status(`"${raw}" is not a valid value for ${param.label}`, 'warn');
        this.render();
        return;
      }
      onSet(param, v);
    };
    let input;
    if (param.readonly) {
      const text = formatValue(param.kind, value);
      input = h('span', { class: 'ro' }, text + (UNITS[param.kind] && text ? ` ${UNITS[param.kind]}` : ''));
    } else if (param.kind === 'select') {
      input = h('select', { disabled, onchange: (e) => commit(e.target.value) });
      if (!same) input.append(h('option', { value: '' }, '<varies>'));
      for (const [v, label] of param.options(this.app)) input.append(h('option', { value: v, selected: same && v === value }, label));
    } else if (param.kind === 'bool') {
      input = h('input', { type: 'checkbox', checked: !!value, disabled, onchange: (e) => commit(e.target.checked) });
      if (!same) input.indeterminate = true;
    } else if (param.kind === 'color') {
      input = h('input', { type: 'color', value: value ?? '#cccccc', disabled, onchange: (e) => commit(e.target.value) });
    } else {
      input = h('input', {
        type: 'text', value: same ? formatValue(param.kind, value) : '', placeholder: same ? '' : '<varies>', disabled,
        inputmode: ['length', 'number', 'meters'].includes(param.kind) ? 'decimal' : undefined,
        onchange: (e) => commit(e.target.value),
        onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      });
    }
    const unit = !param.readonly && UNITS[param.kind] ? h('span', { class: 'unit' }, UNITS[param.kind]) : null;
    return h('div', { class: `prow${disabled ? ' disabled' : ''}` }, h('label', {}, param.label), h('div', { class: 'pval' }, input, unit));
  }
}
