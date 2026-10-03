import { Tool } from './tool.js';
import { add, sub, mul, dist, len, norm, perp, copyPt, polygonArea } from '../core/geom.js';
import { snap } from '../views/snapping.js';
import { drawSnapMarker, drawTempDim, drawLabel, strokePoly } from '../views/overlay.js';

/** Place Wall: chained lines or a rectangle. Type a length (mm) and press Enter for exact walls. */
export class WallTool extends Tool {
  constructor(app) {
    super(app);
    this.mode = 'line';
    this.chain = true;
    this.heightMode = 'next';
    this.height = 3.0;
    this.start = null;
    this.cur = null;
    this.typed = '';
  }

  get category() { return 'Wall'; }
  get title() { return 'Modify | Place Wall'; }
  get hint() {
    if (this.mode === 'rect') return this.start ? 'Click the opposite corner' : 'Click the first corner of a rectangle of walls';
    return this.start
      ? 'Click to end the wall · type a length in mm + Enter · Shift = orthogonal · Esc / right-click ends the chain'
      : 'Click to start a wall';
  }

  activate() { this.reset(); }
  deactivate() { this.reset(); }

  reset() {
    this.start = null;
    this.typed = '';
    this.snapInfo = null;
  }

  cancel() {
    if (!this.start) return false;
    this.reset();
    this.app.status(this.hint);
    this.redraw();
    return true;
  }

  pointerMove(e) {
    this.snapInfo = snap(this.app, this.app.planView, e.world, { anchor: this.mode === 'line' ? this.start : null, ortho: e.shift });
    this.cur = this.snapInfo.p;
    this.redraw();
  }

  pointerDown(e) {
    this.pointerMove(e);
    const p = this.cur;
    if (!this.start) {
      this.start = p;
      this.typed = '';
      this.app.status(this.hint);
      return;
    }
    if (this.mode === 'rect') {
      this.createRect(this.start, p);
      this.start = null;
      this.app.status(this.hint);
      return;
    }
    if (dist(this.start, p) < 0.05) return;
    this.createWalls([[this.start, p]]);
    this.start = this.chain ? p : null;
    this.typed = '';
  }

  keyDown(ev) {
    if (!this.start || this.mode !== 'line') return false;
    if (/^[0-9.]$/.test(ev.key)) {
      this.typed += ev.key;
      this.redraw();
      return true;
    }
    if (ev.key === 'Backspace' && this.typed) {
      this.typed = this.typed.slice(0, -1);
      this.redraw();
      return true;
    }
    if (ev.key === 'Enter' && this.typed) {
      const L = parseFloat(this.typed) / 1000;
      if (L > 0.01) {
        let dir = norm(sub(this.cur ?? this.start, this.start));
        if (!len(dir)) dir = { x: 1, y: 0 };
        const end = add(this.start, mul(dir, L));
        this.createWalls([[this.start, end]]);
        this.start = this.chain ? end : null;
      }
      this.typed = '';
      this.redraw();
      return true;
    }
    return false;
  }

  createWalls(segs) {
    const app = this.app;
    const level = app.activeLevel;
    const above = app.levelAbove(level.id);
    const typeId = app.typeFor('Wall');
    app.doc.transact(segs.length > 1 ? 'Create Walls' : 'Create Wall', () => {
      for (const [a, b] of segs) {
        app.doc.add({
          category: 'Wall', typeId, levelId: level.id, baseOffset: 0,
          topLevelId: this.heightMode === 'next' && above ? above.id : null, topOffset: 0, height: this.height,
          a: copyPt(a), b: copyPt(b), mark: '', comments: '',
        });
      }
    });
  }

  rectCorners(p, q) {
    const c = [copyPt(p), { x: q.x, y: p.y }, copyPt(q), { x: p.x, y: q.y }];
    return polygonArea(c) < 0 ? c.reverse() : c; // counter-clockwise: wall interiors on the left
  }

  createRect(p, q) {
    if (Math.abs(q.x - p.x) < 0.1 || Math.abs(q.y - p.y) < 0.1) return;
    const c = this.rectCorners(p, q);
    this.createWalls(c.map((pt, i) => [pt, c[(i + 1) % 4]]));
  }

  drawOverlay(ctx, view) {
    const t = this.app.doc.type(this.app.typeFor('Wall'))?.thickness ?? 0.2;
    const ghost = (a, b) => {
      if (dist(a, b) < 1e-4) return;
      const n = mul(perp(norm(sub(b, a))), t / 2);
      strokePoly(ctx, view, [add(a, n), add(b, n), sub(b, n), sub(a, n)], { fill: 'rgba(10,108,255,0.14)', width: 1 });
    };
    if (this.start && this.cur) {
      if (this.mode === 'rect') {
        const c = this.rectCorners(this.start, this.cur);
        c.forEach((pt, i) => ghost(pt, c[(i + 1) % 4]));
        drawTempDim(ctx, view, { x: Math.min(c[0].x, c[2].x), y: Math.max(c[0].y, c[2].y) }, { x: Math.max(c[0].x, c[2].x), y: Math.max(c[0].y, c[2].y) }, -22, `${Math.round(Math.abs(this.cur.x - this.start.x) * 1000)}`);
        drawTempDim(ctx, view, { x: Math.max(c[0].x, c[2].x), y: Math.max(c[0].y, c[2].y) }, { x: Math.max(c[0].x, c[2].x), y: Math.min(c[0].y, c[2].y) }, -22, `${Math.round(Math.abs(this.cur.y - this.start.y) * 1000)}`);
      } else {
        ghost(this.start, this.cur);
        const L = dist(this.start, this.cur);
        drawTempDim(ctx, view, this.start, this.cur, -26, `${Math.round(L * 1000)}`);
        if (this.typed) {
          const s = view.toScreen(this.cur);
          drawLabel(ctx, s.x + 14, s.y + 18, `Length: ${this.typed}▌ mm  (Enter)`, { align: 'left', color: '#fff', bg: '#0a6cff' });
        }
      }
    }
    drawSnapMarker(ctx, view, this.snapInfo);
  }

  renderOptions(el) {
    el.innerHTML = `
      <span class="opt-title">${this.title}</span>
      ${Tool.segmented('mode', [['line', 'Line'], ['rect', 'Rectangle']], this.mode)}
      <label>Height
        <select data-k="heightMode">
          <option value="next" ${this.heightMode === 'next' ? 'selected' : ''}>Up to next level</option>
          <option value="fixed" ${this.heightMode === 'fixed' ? 'selected' : ''}>Unconnected</option>
        </select>
      </label>
      <label>Unconnected <input data-k="height" type="number" step="100" min="100" value="${Math.round(this.height * 1000)}" ${this.heightMode === 'next' ? 'disabled' : ''}> mm</label>
      <label class="chk"><input data-k="chain" type="checkbox" ${this.chain ? 'checked' : ''}> Chain</label>`;
    el.querySelector('.seg').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.mode = b.dataset.value;
      this.reset();
      this.renderOptions(el);
      this.app.status(this.hint);
    });
    el.querySelector('[data-k=heightMode]').addEventListener('change', (e) => {
      this.heightMode = e.target.value;
      this.renderOptions(el);
    });
    el.querySelector('[data-k=height]').addEventListener('change', (e) => {
      const v = parseFloat(e.target.value);
      if (v > 0) this.height = v / 1000;
    });
    el.querySelector('[data-k=chain]').addEventListener('change', (e) => { this.chain = e.target.checked; });
  }
}
