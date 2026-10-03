import { h } from './dom.js';
import { icon } from './icons.js';
import { SCHEDULES } from '../views/scheduleView.js';
import { CATEGORY_PLURAL } from '../core/template.js';

/** Project Browser: views, schedules and families (types with instance counts). */
export class ProjectBrowser {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.collapsed = new Set(['fam:Door', 'fam:Window', 'fam:Floor', 'fam:Column']);
    for (const ev of ['model', 'view']) app.on(ev, ({ reason } = {}) => { if (reason !== 'live') this.render(); });
    this.render();
  }

  node(key, label, children, { iconName, count } = {}) {
    const open = !this.collapsed.has(key);
    const head = h('button', {
      class: 'tnode', type: 'button',
      onclick: () => {
        if (open) this.collapsed.add(key);
        else this.collapsed.delete(key);
        this.render();
      },
    });
    head.innerHTML = `<span class="caret ${open ? 'open' : ''}">${icon('chevron', 12)}</span>${iconName ? icon(iconName, 15) : ''}<span class="tlabel"></span>${count !== undefined ? `<span class="count">${count}</span>` : ''}`;
    head.querySelector('.tlabel').textContent = label;
    return h('div', { class: 'tgroup' }, head, open ? h('div', { class: 'tchildren' }, children) : null);
  }

  leaf(label, { active = false, onclick, iconName, count, title } = {}) {
    const b = h('button', { class: `tleaf${active ? ' active' : ''}`, type: 'button', onclick, title });
    b.innerHTML = `${iconName ? icon(iconName, 14) : ''}<span class="tlabel"></span>${count !== undefined ? `<span class="count">${count}</span>` : ''}`;
    b.querySelector('.tlabel').textContent = label;
    return b;
  }

  render() {
    const { app } = this;
    const scroll = this.body?.scrollTop ?? 0;
    const showPlan = () => { if (app.viewMode === '3d' || app.viewMode === 'schedule') app.setViewMode('split'); };

    const plans = app.doc.levels().map((l) => this.leaf(l.name, {
      active: l.id === app.activeLevelId && app.viewMode !== '3d' && app.viewMode !== 'schedule',
      iconName: 'plan',
      title: `Elevation ${Math.round(l.elevation * 1000)} mm`,
      onclick: () => { app.setActiveLevel(l.id); showPlan(); },
    }));
    plans.push(h('button', { class: 'tleaf add', type: 'button', onclick: () => app.addLevel() }, '+ New level'));

    const views = this.node('views', 'Views (all)', [
      this.node('plans', 'Floor Plans', plans),
      this.node('3d', '3D Views', [this.leaf('{3D}', {
        iconName: 'cube',
        active: app.viewMode === '3d',
        onclick: () => app.setViewMode(app.viewMode === 'split' ? 'split' : '3d'),
      })]),
    ]);

    const schedules = this.node('schedules', 'Schedules/Quantities', Object.entries(SCHEDULES).map(([k, def]) => this.leaf(def.title, {
      iconName: 'table',
      active: app.viewMode === 'schedule' && app.scheduleKey === k,
      onclick: () => app.openSchedule(k),
    })));

    const families = this.node('families', 'Families', ['Wall', 'Door', 'Window', 'Floor', 'Column'].map((cat) =>
      this.node(`fam:${cat}`, CATEGORY_PLURAL[cat], app.doc.typesOf(cat).map((t) => this.leaf(t.name, {
        count: app.doc.instancesOfType(t.id).length,
        title: 'Click to select all instances',
        onclick: () => app.selectAllOfType(t.id),
      })))));

    this.body = h('div', { class: 'panel-body tree' }, views, schedules, families);
    this.el.replaceChildren(h('div', { class: 'panel-title' }, 'Project Browser — ', h('span', { class: 'muted' }, app.doc.name)), this.body);
    this.body.scrollTop = scroll;
  }
}
