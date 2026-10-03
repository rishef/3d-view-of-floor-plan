import { defaultTypes, defaultLevels } from './template.js';
import { DEFAULT_SITE } from './site.js';

let seq = 0;
export function newId(prefix = 'e') {
  seq = (seq + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const MAX_UNDO = 200;
const ID_PREFIX = { Wall: 'w', Door: 'd', Window: 'wn', Floor: 'f', Column: 'c', Room: 'r', Grid: 'g', Level: 'lvl', Context: 'ctx' };

/**
 * The single source of truth for a project, like a Revit .rvt:
 * every element and type lives here, every view reads from here.
 *
 * All edits go through transactions so that undo/redo is uniform.
 * A transaction snapshots the project before and after, which keeps the
 * implementation trivially correct; a production engine would store deltas instead.
 */
export class BimDocument extends EventTarget {
  constructor(data) {
    super();
    this.tx = null;
    this.undoStack = [];
    this.redoStack = [];
    this.load(data ?? BimDocument.blank());
  }

  static blank() {
    return { format: 'keystone-bim', version: 1, name: 'Untitled Project', site: { ...DEFAULT_SITE }, types: defaultTypes(), elements: defaultLevels() };
  }

  load(data) {
    if (!data || !Array.isArray(data.elements) || !Array.isArray(data.types)) {
      throw new Error('This is not a Keystone BIM project file.');
    }
    this.name = data.name || 'Untitled Project';
    this.site = { ...DEFAULT_SITE, ...(data.site ?? {}) };
    this.types = new Map(data.types.map((t) => [t.id, structuredClone(t)]));
    this.elements = new Map(data.elements.map((e) => [e.id, structuredClone(e)]));
    this.tx = null;
    this.undoStack = [];
    this.redoStack = [];
    this.emitChange('load');
  }

  toJSON() {
    return { format: 'keystone-bim', version: 1, name: this.name, site: this.site, types: [...this.types.values()], elements: [...this.elements.values()] };
  }

  // ---- queries -------------------------------------------------------------
  get(id) { return this.elements.get(id); }
  type(id) { return this.types.get(id); }
  all() { return [...this.elements.values()]; }

  byCategory(category) {
    const out = [];
    for (const e of this.elements.values()) if (e.category === category) out.push(e);
    return out;
  }

  typesOf(category) { return [...this.types.values()].filter((t) => t.category === category); }
  levels() { return this.byCategory('Level').sort((a, b) => a.elevation - b.elevation); }
  instancesOfType(typeId) { return this.all().filter((e) => e.typeId === typeId); }
  hosted(hostId) { return this.all().filter((e) => e.hostId === hostId); }

  // ---- mutations (only valid inside a transaction) ---------------------------
  add(el) {
    this.assertTx();
    if (!el.id) el.id = newId(ID_PREFIX[el.category] ?? 'e');
    this.elements.set(el.id, el);
    return el;
  }

  /** Removes an element and anything hosted by it (doors/windows in a wall). */
  remove(id) {
    this.assertTx();
    if (!this.elements.delete(id)) return;
    for (const e of this.all()) if (e.hostId === id) this.elements.delete(e.id);
  }

  addType(t) {
    this.assertTx();
    if (!t.id) t.id = newId('t');
    this.types.set(t.id, t);
    return t;
  }

  assertTx() {
    if (!this.tx) throw new Error('Model changes must happen inside a transaction');
  }

  // ---- transactions --------------------------------------------------------
  get inTransaction() { return !!this.tx; }

  transact(name, fn) {
    if (this.tx) return fn();
    this.begin(name);
    try {
      const result = fn();
      this.commit();
      return result;
    } catch (err) {
      this.rollback();
      throw err;
    }
  }

  begin(name) {
    if (this.tx) throw new Error(`Transaction "${this.tx.name}" is already open`);
    this.tx = { name, before: JSON.stringify(this.toJSON()) };
  }

  commit() {
    const tx = this.tx;
    if (!tx) return;
    this.tx = null;
    const after = JSON.stringify(this.toJSON());
    if (after !== tx.before) {
      this.undoStack.push({ name: tx.name, before: tx.before, after });
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      this.redoStack = [];
    }
    this.emitChange(tx.name);
  }

  rollback() {
    const tx = this.tx;
    if (!tx) return;
    this.tx = null;
    this.restore(tx.before, 'rollback');
  }

  /** Lets views refresh while a long interaction (a drag) is still inside its transaction. */
  notify() { this.emitChange('live'); }

  undo() {
    if (this.tx) return null;
    const tx = this.undoStack.pop();
    if (!tx) return null;
    this.redoStack.push(tx);
    this.restore(tx.before, 'undo');
    return tx.name;
  }

  redo() {
    if (this.tx) return null;
    const tx = this.redoStack.pop();
    if (!tx) return null;
    this.undoStack.push(tx);
    this.restore(tx.after, 'redo');
    return tx.name;
  }

  restore(json, reason) {
    const d = JSON.parse(json);
    this.name = d.name;
    this.site = { ...DEFAULT_SITE, ...(d.site ?? {}) };
    this.types = new Map(d.types.map((t) => [t.id, t]));
    this.elements = new Map(d.elements.map((e) => [e.id, e]));
    this.emitChange(reason);
  }

  emitChange(reason) {
    this.dispatchEvent(new CustomEvent('change', { detail: { reason } }));
  }
}
