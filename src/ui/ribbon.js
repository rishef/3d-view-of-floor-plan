import { icon } from './icons.js';
import { h } from './dom.js';
import { saveProject, openProject } from '../io/fileio.js';
import { downloadIFC, downloadGLB } from '../io/exporters.js';
import { openImportDialog } from './importDialog.js';
import { openSiteDialog } from './siteDialog.js';

export class Ribbon {
  constructor(el, optionsEl, app) {
    this.el = el;
    this.optionsEl = optionsEl;
    this.app = app;
    this.buttons = new Map();

    const groups = [
      ['Project', [
        ['new', 'New', 'new', () => app.newProject()],
        ['open', 'Open', 'open', () => openProject(app)],
        ['save', 'Save', 'save', () => saveProject(app), 'Ctrl+S'],
        ['sample', 'Sample', 'house', () => app.loadSample()],
      ]],
      ['Insert', [
        ['import', 'Import Plan', 'importPlan', () => openImportDialog(app), 'Image, PDF or DXF floor plan → 3D model'],
      ]],
      ['Export', [
        ['ifc', 'IFC', 'ifc', () => downloadIFC(app)],
        ['glb', 'glTF', 'cube', () => downloadGLB(app)],
      ]],
      ['Edit', [
        ['undo', 'Undo', 'undo', () => app.undo(), 'Ctrl+Z'],
        ['redo', 'Redo', 'redo', () => app.redo(), 'Ctrl+Y'],
      ]],
      ['Modify', [
        ['tool:select', 'Modify', 'select', null, 'MD'],
        ['copy', 'Copy', 'copy', () => app.copySelection(), 'Ctrl+C'],
        ['paste', 'Paste', 'paste', () => app.paste(), 'Ctrl+V · aligned to the active level'],
        ['delete', 'Delete', 'trash', () => app.deleteSelection(), 'Del'],
      ]],
      ['Build', [
        ['tool:wall', 'Wall', 'wall', null, 'WA'],
        ['tool:door', 'Door', 'door', null, 'DR'],
        ['tool:window', 'Window', 'window', null, 'WN'],
        ['tool:floor', 'Floor', 'floor', null, 'FL'],
        ['tool:column', 'Column', 'column', null, 'CL'],
      ]],
      ['Room & Area', [['tool:room', 'Room', 'room', null, 'RM']]],
      ['Datum', [
        ['tool:grid', 'Grid', 'grid', null, 'GR'],
        ['level', 'Level', 'level', () => app.addLevel(), 'Adds a level above the highest one'],
      ]],
      ['Walkthrough', [
        ['walk', 'Walk', 'walk', () => app.walk.enter(), 'First-person walk through the rooms (WK)'],
        ['tour', 'Tour', 'tour', () => app.walk.enter({ tour: true }), 'Automatic tour through every room, door to door'],
      ]],
      ['Site & Sun', [
        ['site', 'Site', 'site', () => openSiteDialog(app), 'Location, plan orientation and nearby buildings'],
        ['sun', 'Sun Study', 'sun', () => app.toggleSunStudy(), 'Real sun position, shadows and window sunlight by time of day'],
      ]],
    ];

    el.append(h('div', { class: 'brand' }, h('div', { class: 'brand-mark', html: icon('cube', 22) }), h('div', {}, h('div', { class: 'brand-name' }, 'Keystone'), h('div', { class: 'brand-sub' }, 'BIM'))));
    for (const [label, items] of groups) {
      const btns = items.map(([id, text, ic, fn, tip]) => {
        const b = h('button', {
          class: 'rbtn', type: 'button', title: tip ? `${text} (${tip})` : text,
          onclick: () => (id.startsWith('tool:') ? app.setTool(id.slice(5)) : fn()),
        });
        b.innerHTML = `${icon(ic, 22)}<span>${text}</span>`;
        this.buttons.set(id, b);
        return b;
      });
      el.append(h('div', { class: 'rgroup' }, h('div', { class: 'btns' }, btns), h('div', { class: 'glabel' }, label)));
    }

    app.on('tool', () => this.update());
    app.on('model', () => this.update());
    app.on('selection', () => this.update());
    app.on('clipboard', () => this.update());
    app.on('sun', () => this.update());
    app.on('walk', () => this.buttons.get('walk').classList.toggle('active', !!app.walk?.active));
    this.update();
  }

  update() {
    const { app } = this;
    for (const [id, b] of this.buttons) if (id.startsWith('tool:')) b.classList.toggle('active', app.toolName === id.slice(5));
    this.buttons.get('undo').disabled = !app.doc.undoStack.length;
    this.buttons.get('redo').disabled = !app.doc.redoStack.length;
    this.buttons.get('copy').disabled = !app.selection.size;
    this.buttons.get('delete').disabled = !app.selection.size;
    this.buttons.get('paste').disabled = !app.clipboard;
    this.buttons.get('sun').classList.toggle('active', app.sun.enabled);
    if (this.renderedTool !== app.tool) {
      this.renderedTool = app.tool;
      app.tool.renderOptions(this.optionsEl);
    }
  }
}
