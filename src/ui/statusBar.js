import { h } from './dom.js';
import { icon } from './icons.js';

export class StatusBar {
  constructor(el, app) {
    this.app = app;
    this.hint = h('span', { class: 'sb-hint' });
    this.coords = h('span', { class: 'sb-coords' });
    this.sel = h('span', { class: 'sb-sel' });
    this.warnBtn = h('button', { class: 'sb-warn', type: 'button', onclick: () => this.toggleWarnings() });
    this.popover = h('div', { class: 'warn-pop', hidden: true });
    el.append(this.hint, h('span', { class: 'spacer' }), this.coords, this.sel, this.warnBtn, this.popover);

    let timer = 0;
    app.on('status', ({ text, kind }) => {
      this.hint.textContent = text;
      this.hint.classList.toggle('warn', kind === 'warn');
      clearTimeout(timer);
      if (kind === 'warn') timer = setTimeout(() => this.showHint(), 4000);
    });
    app.on('tool', () => this.showHint());
    app.on('cursor', (p) => {
      this.coords.textContent = p && p.x !== undefined ? `X ${Math.round(p.x * 1000)}   Y ${Math.round(p.y * 1000)} mm` : '';
    });
    app.on('selection', () => this.update());
    app.on('model', ({ reason }) => { if (reason !== 'live') this.update(); });
    this.showHint();
    this.update();
  }

  showHint() {
    this.hint.textContent = this.app.tool.hint;
    this.hint.classList.remove('warn');
  }

  update() {
    const n = this.app.selection.size;
    this.sel.textContent = n ? `${n} selected` : '';
    const w = this.app.model.warnings.length;
    this.warnBtn.innerHTML = `${icon('warn', 14)}<span>${w} warning${w === 1 ? '' : 's'}</span>`;
    this.warnBtn.classList.toggle('has', w > 0);
    if (!this.popover.hidden) this.renderWarnings();
  }

  toggleWarnings() {
    this.popover.hidden = !this.popover.hidden;
    if (!this.popover.hidden) this.renderWarnings();
  }

  renderWarnings() {
    const list = this.app.model.warnings;
    this.popover.replaceChildren(
      h('div', { class: 'warn-head' }, `Warnings (${list.length})`, h('button', { class: 'linkbtn', type: 'button', onclick: () => { this.popover.hidden = true; } }, 'Close')),
      list.length
        ? h('div', { class: 'warn-list' }, list.map((w) => h('button', {
          class: 'warn-item', type: 'button',
          onclick: () => {
            const el = this.app.doc.get(w.id);
            const levelId = el?.levelId ?? this.app.doc.get(el?.hostId)?.levelId;
            if (levelId) this.app.setActiveLevel(levelId);
            this.app.select([w.id]);
          },
        }, w.message)))
        : h('div', { class: 'warn-empty' }, 'No warnings. The model is clean.'),
    );
  }
}
