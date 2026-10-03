import { saveProject } from '../io/fileio.js';
import { planVisibility } from '../views/planRender.js';

/** Revit-style two-letter shortcuts (type W then A for Wall) plus the usual editing keys. */
const SHORTCUTS = {
  WA: ['tool', 'wall'],
  DR: ['tool', 'door'],
  WN: ['tool', 'window'],
  FL: ['tool', 'floor'],
  CL: ['tool', 'column'],
  RM: ['tool', 'room'],
  GR: ['tool', 'grid'],
  MD: ['tool', 'select'],
  WK: ['walk'],
  ZF: ['fit'],
  ZE: ['fit'],
};

export function installKeyboard(app) {
  let buffer = '';
  let timer = 0;

  window.addEventListener('keydown', (e) => {
    if (document.querySelector('.modal-backdrop') || app.walk?.active) return;
    const target = e.target;
    if (target instanceof Element && target.closest('input, select, textarea, [contenteditable]')) {
      if (e.key === 'Escape') target.blur();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod) {
      const k = e.key.toLowerCase();
      const actions = {
        z: () => (e.shiftKey ? app.redo() : app.undo()),
        y: () => app.redo(),
        s: () => saveProject(app),
        c: () => app.copySelection(),
        v: () => app.paste(),
        a: () => {
          const vis = planVisibility(app);
          app.select([...vis.walls.map((f) => f.id), ...vis.openings.map((o) => o.id), ...vis.floors.map((f) => f.id), ...vis.rooms.map((r) => r.id), ...vis.columns.map((c) => c.id)]);
        },
      };
      if (actions[k]) {
        e.preventDefault();
        actions[k]();
      }
      return;
    }
    if (app.tool.keyDown(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      app.cancel();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      app.deleteSelection();
      return;
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (arrows[e.key] && app.selection.size) {
      e.preventDefault();
      const step = e.shiftKey ? 0.1 : 0.01;
      app.nudgeSelection(arrows[e.key][0] * step, arrows[e.key][1] * step);
      return;
    }
    if (e.key === 'Tab') e.preventDefault();
    if (/^[a-z]$/i.test(e.key)) {
      buffer = (buffer + e.key.toUpperCase()).slice(-2);
      clearTimeout(timer);
      timer = setTimeout(() => { buffer = ''; }, 1200);
      const cmd = SHORTCUTS[buffer];
      if (!cmd) return;
      buffer = '';
      if (cmd[0] === 'tool') app.setTool(cmd[1]);
      else if (cmd[0] === 'walk') app.walk.enter();
      else if (cmd[0] === 'fit') {
        app.planView.fit();
        app.view3d.fit();
      }
    }
  });
}
