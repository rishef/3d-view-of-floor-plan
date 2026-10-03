import { BimDocument } from './core/document.js';
import { regenerate } from './core/regen.js';
import { moveElements } from './core/edit.js';
import { sampleProject } from './sample.js';
import { createTools } from './tools/index.js';
import { confirmDialog } from './ui/dialogs.js';

const AUTOSAVE_KEY = 'keystone-bim:autosave';

function readAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Application state around the document: selection, active view, active tool, clipboard.
 * Emits: model, selection, hover, tool, view, status, cursor.
 */
export class App extends EventTarget {
  constructor() {
    super();
    let doc;
    try {
      doc = new BimDocument(readAutosave() ?? sampleProject());
    } catch {
      doc = new BimDocument(sampleProject());
    }
    this.doc = doc;
    this.model = regenerate(doc);
    this.selection = new Set();
    this.hoverId = null;
    this.activeLevelId = doc.levels()[0]?.id ?? null;
    this.viewMode = 'split'; // plan | split | 3d | schedule
    this.scheduleKey = 'walls';
    this.viewSettings = { cutHeight: 1.2, underlay: true, showGrid: true, sectionBox: false, shadows: true, edges: true };
    this.placementTypes = {};
    this.clipboard = null;
    this.underlays = new Map(); // levelId -> imported drawing shown faded under the plan (session only)
    const today = new Date();
    this.sun = {
      enabled: false,
      date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
      minutes: 10 * 60,
      showPath: true,
      playing: false,
    };
    this.autosaveTimer = 0;

    doc.addEventListener('change', (e) => this.onDocChange(e.detail.reason));
    this.tools = createTools(this);
    this.toolName = 'select';
    this.tool = this.tools.select;
  }

  // ---- events --------------------------------------------------------------
  on(name, fn) { this.addEventListener(name, (e) => fn(e.detail ?? {})); }
  emit(name, detail = {}) { this.dispatchEvent(new CustomEvent(name, { detail })); }
  status(text, kind = 'info') { this.emit('status', { text, kind }); }

  onDocChange(reason) {
    this.model = regenerate(this.doc);
    for (const id of [...this.selection]) if (!this.doc.get(id)) this.selection.delete(id);
    if (this.hoverId && !this.doc.get(this.hoverId)) this.hoverId = null;
    if (!this.doc.get(this.activeLevelId)) this.activeLevelId = this.doc.levels()[0]?.id ?? null;
    this.emit('model', { reason });
    if (reason !== 'live') this.scheduleAutosave();
  }

  scheduleAutosave() {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.doc.toJSON()));
      } catch {
        /* storage unavailable or full: autosave is a convenience only */
      }
    }, 600);
  }

  // ---- levels & views --------------------------------------------------------
  get activeLevel() { return this.doc.get(this.activeLevelId); }

  levelAbove(id) {
    const levels = this.doc.levels();
    const i = levels.findIndex((l) => l.id === id);
    return i >= 0 ? levels[i + 1] ?? null : null;
  }

  levelBelow(id) {
    const levels = this.doc.levels();
    const i = levels.findIndex((l) => l.id === id);
    return i > 0 ? levels[i - 1] : null;
  }

  setActiveLevel(id) {
    if (!this.doc.get(id) || id === this.activeLevelId) return;
    this.activeLevelId = id;
    this.tool.cancel();
    this.emit('view');
  }

  setViewMode(mode) {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    document.getElementById('viewPanes').dataset.mode = mode;
    this.emit('view');
  }

  setViewSetting(key, value) {
    this.viewSettings[key] = value;
    this.emit('view');
  }

  setUnderlay(levelId, underlay) {
    if (underlay) this.underlays.set(levelId, underlay);
    else this.underlays.delete(levelId);
    this.emit('view');
  }

  setSun(patch) {
    Object.assign(this.sun, patch);
    this.emit('sun');
  }

  toggleSunStudy() {
    if (!this.sun.enabled && (this.viewMode === 'plan' || this.viewMode === 'schedule')) this.setViewMode('split');
    this.setSun({ enabled: !this.sun.enabled });
  }

  openSchedule(key) {
    this.scheduleKey = key;
    if (this.viewMode !== 'schedule') this.setViewMode('schedule');
    else this.emit('view');
  }

  addLevel() {
    const levels = this.doc.levels();
    const top = levels[levels.length - 1];
    const gap = levels.length > 1 ? top.elevation - levels[levels.length - 2].elevation : 3;
    let i = levels.length + 1;
    let name;
    do name = `Level ${i++}`; while (levels.some((l) => l.name === name));
    const lvl = this.doc.transact('Create Level', () =>
      this.doc.add({ category: 'Level', name, elevation: +((top?.elevation ?? 0) + (gap > 0 ? gap : 3)).toFixed(3) }));
    this.setActiveLevel(lvl.id);
    this.status(`${name} created — its floor plan is now active`);
  }

  async deleteLevel(id) {
    const lvl = this.doc.get(id);
    if (!lvl) return;
    if (this.doc.levels().length <= 1) {
      this.status('A project needs at least one level', 'warn');
      return;
    }
    const onLevel = this.doc.all().filter((e) => e.levelId === id);
    const ok = await confirmDialog(`Delete ${lvl.name} and the ${onLevel.length} element(s) placed on it? You can undo this.`, { title: 'Delete level', ok: 'Delete level', danger: true });
    if (!ok || !this.doc.get(id)) return;
    this.doc.transact('Delete Level', () => {
      for (const e of onLevel) this.doc.remove(e.id);
      for (const e of this.doc.all()) {
        if (e.topLevelId !== id) continue;
        const f = this.model.walls.get(e.id) ?? this.model.columns.get(e.id);
        if (f) e.height = f.topZ - f.baseZ;
        e.topLevelId = null;
      }
      this.doc.remove(id);
    });
  }

  // ---- tools & types ---------------------------------------------------------
  setTool(name) {
    const next = this.tools[name];
    if (!next) return;
    this.tool.deactivate();
    this.toolName = name;
    this.tool = next;
    next.activate();
    if (name !== 'select') {
      this.setHover(null);
      if (this.viewMode === '3d' || this.viewMode === 'schedule') this.setViewMode('split');
    }
    this.emit('tool');
    this.status(next.hint);
  }

  /** Esc / right-click: cancel the current operation, then leave the tool, then clear selection. */
  cancel() {
    if (this.tool.cancel()) return;
    if (this.toolName !== 'select') this.setTool('select');
    else this.clearSelection();
  }

  typeFor(category) {
    const id = this.placementTypes[category];
    if (id && this.doc.type(id)) return id;
    return this.doc.typesOf(category)[0]?.id ?? null;
  }

  setTypeFor(category, typeId) {
    this.placementTypes[category] = typeId;
    this.emit('tool');
  }

  // ---- selection ---------------------------------------------------------------
  select(ids, mode = 'replace') {
    if (mode === 'replace') this.selection = new Set(ids);
    else if (mode === 'add') ids.forEach((id) => this.selection.add(id));
    else if (mode === 'toggle') ids.forEach((id) => (this.selection.has(id) ? this.selection.delete(id) : this.selection.add(id)));
    this.emit('selection');
  }

  clearSelection() {
    if (!this.selection.size) return;
    this.selection = new Set();
    this.emit('selection');
  }

  setHover(id) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.emit('hover');
  }

  selectAllOfType(typeId) {
    this.select(this.doc.instancesOfType(typeId).map((e) => e.id));
    const n = this.selection.size;
    this.status(`Selected all ${n} instance${n === 1 ? '' : 's'} of "${this.doc.type(typeId)?.name}"`);
  }

  // ---- commands ------------------------------------------------------------------
  deleteSelection() {
    const ids = [...this.selection].filter((id) => this.doc.get(id)?.category !== 'Level');
    if (!ids.length) return;
    this.doc.transact(`Delete ${ids.length} element${ids.length > 1 ? 's' : ''}`, () => ids.forEach((id) => this.doc.remove(id)));
    this.clearSelection();
  }

  nudgeSelection(dx, dy) {
    const ids = [...this.selection];
    if (!ids.length) return;
    this.doc.transact('Nudge', () => moveElements(this.doc, ids, { x: dx, y: dy }));
  }

  copySelection() {
    const ids = new Set(this.selection);
    for (const id of [...ids]) {
      if (this.doc.get(id)?.category === 'Wall') this.doc.hosted(id).forEach((o) => ids.add(o.id));
    }
    const els = [...ids].map((id) => this.doc.get(id)).filter((e) => e && e.category !== 'Level');
    if (!els.length) return;
    const heights = {};
    for (const e of els) {
      const f = this.model.walls.get(e.id) ?? this.model.columns.get(e.id);
      if (f) heights[e.id] = f.topZ - f.baseZ;
    }
    this.clipboard = { sourceLevelId: this.activeLevelId, elements: structuredClone(els), heights };
    this.emit('clipboard');
    this.status(`Copied ${els.length} element(s). Switch level and press Ctrl+V to paste aligned.`);
  }

  /** Revit's "Paste Aligned to Current View": same XY position, moved onto the active level. */
  paste() {
    const cb = this.clipboard;
    if (!cb) return;
    const target = this.activeLevel;
    const above = this.levelAbove(target.id);
    const sameLevel = cb.sourceLevelId === target.id;
    const idMap = new Map();
    const created = [];
    this.doc.transact('Paste Aligned', () => {
      for (const src of cb.elements) {
        if (src.hostId) continue;
        const el = structuredClone(src);
        delete el.id;
        if ('levelId' in el) el.levelId = target.id;
        if ((el.category === 'Wall' || el.category === 'Column') && el.topLevelId) {
          el.topLevelId = above?.id ?? null;
          if (!el.topLevelId) el.height = cb.heights[src.id] ?? el.height;
        }
        if (el.category === 'Room') el.number = this.nextRoomNumber(target.id);
        this.doc.add(el);
        idMap.set(src.id, el.id);
        created.push(el.id);
      }
      for (const src of cb.elements) {
        const host = src.hostId && idMap.get(src.hostId);
        if (!host) continue;
        const el = structuredClone(src);
        delete el.id;
        el.hostId = host;
        el.mark = this.nextMark(el.category);
        this.doc.add(el);
        created.push(el.id);
      }
      if (sameLevel) moveElements(this.doc, created, { x: 1, y: -1 });
    });
    this.select(created);
    this.status(`Pasted ${created.length} element(s) onto ${target.name}${sameLevel ? ' (offset 1 m)' : ''}`);
  }

  undo() {
    const name = this.doc.undo();
    this.status(name ? `Undo: ${name}` : 'Nothing to undo');
  }

  redo() {
    const name = this.doc.redo();
    this.status(name ? `Redo: ${name}` : 'Nothing to redo');
  }

  loadProject(data) {
    this.tool.cancel();
    this.doc.load(data);
    this.selection = new Set();
    this.activeLevelId = this.doc.levels()[0]?.id ?? null;
    this.emit('selection');
    this.emit('view');
    this.planView?.fit();
    this.view3d?.fit();
  }

  async newProject() {
    if (!(await confirmDialog('Start a new empty project? Unsaved changes to the current project will be lost (Save first if you need them).', { title: 'New project', ok: 'Start new project', danger: true }))) return;
    this.loadProject(BimDocument.blank());
    this.status('New project created from the default template');
  }

  async loadSample() {
    if (!(await confirmDialog('Replace the current project with the sample house?', { title: 'Load sample', ok: 'Load sample' }))) return;
    this.loadProject(sampleProject());
  }

  // ---- naming helpers --------------------------------------------------------------
  nextMark(category) {
    const prefix = category === 'Door' ? 'D' : category === 'Window' ? 'W' : '';
    let max = 0;
    for (const e of this.doc.byCategory(category)) {
      const m = /(\d+)$/.exec(e.mark || '');
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `${prefix}${String(max + 1).padStart(2, '0')}`;
  }

  nextRoomNumber(levelId) {
    const idx = Math.max(0, this.doc.levels().findIndex((l) => l.id === levelId));
    let max = (idx + 1) * 100;
    for (const r of this.doc.byCategory('Room')) {
      if (r.levelId !== levelId) continue;
      const v = parseInt(r.number, 10);
      if (Number.isFinite(v)) max = Math.max(max, v);
    }
    return String(max + 1);
  }

  nextGridName(vertical) {
    const names = this.doc.byCategory('Grid').map((g) => g.name);
    if (vertical) {
      const nums = names.map((s) => parseInt(s, 10)).filter(Number.isFinite);
      return String((nums.length ? Math.max(...nums) : 0) + 1);
    }
    const letters = names.filter((s) => /^[A-Z]$/.test(s)).map((s) => s.charCodeAt(0));
    const next = letters.length ? Math.max(...letters) + 1 : 65;
    return next <= 90 ? String.fromCharCode(next) : `A${next - 90}`;
  }
}
