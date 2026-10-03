import { clamp, bounds } from '../core/geom.js';
import { wallFootprint, columnCorners } from '../core/regen.js';
import { drawModel, planVisibility, pickCandidates, pickInRect, drawNorthArrow } from './planRender.js';

/**
 * Floor plan view: a 2D canvas with pan/zoom that forwards pointer input to the active tool.
 * Middle- or right-drag pans, wheel zooms about the cursor, a right click without dragging cancels.
 */
export class PlanView {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.app = app;
    this.ctx = canvas.getContext('2d');
    this.scale = 40; // px per metre
    this.ox = 0;
    this.oy = 0;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.fitted = false;
    this.pan = null;
    this.raf = 0;

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointerleave', () => {
      if (!this.pan) app.emit('cursor', null);
    });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('dblclick', (e) => app.tool.doubleClick(this.evt(e)));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    for (const ev of ['model', 'selection', 'hover', 'tool', 'walk']) app.on(ev, () => this.draw());
    app.on('view', () => {
      this.updateLabel();
      this.draw();
    });
    this.updateLabel();
  }

  updateLabel() {
    const label = this.canvas.parentElement.querySelector('.pane-label');
    if (label) label.textContent = `Floor Plan: ${this.app.activeLevel?.name ?? '—'}`;
  }

  toScreen(p) { return { x: this.ox + p.x * this.scale, y: this.oy - p.y * this.scale }; }
  toWorld(x, y) { return { x: (x - this.ox) / this.scale, y: (this.oy - y) / this.scale }; }

  evt(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    return { sx, sy, world: this.toWorld(sx, sy), button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const cx = this.w ? this.toWorld(this.w / 2, this.h / 2) : null;
    this.dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    if (!this.fitted) {
      this.fitted = true;
      this.fit();
      return;
    }
    if (cx) {
      // keep the same world point centred when the pane changes size
      this.ox = this.w / 2 - cx.x * this.scale;
      this.oy = this.h / 2 + cx.y * this.scale;
    }
    this.render();
  }

  fit() {
    if (!this.w) return;
    const vis = planVisibility(this.app);
    const pts = [];
    vis.walls.forEach((f) => pts.push(...wallFootprint(f)));
    vis.underlay.forEach((f) => pts.push(f.a, f.b));
    vis.floors.forEach((f) => pts.push(...f.boundary));
    vis.columns.forEach((c) => pts.push(...columnCorners(c)));
    vis.grids.forEach((g) => pts.push(g.a, g.b));
    vis.context.forEach((c) => pts.push(...c.corners));
    if (!pts.length && vis.drawing?.kind === 'image') pts.push({ x: vis.drawing.x, y: vis.drawing.y }, { x: vis.drawing.x + vis.drawing.w, y: vis.drawing.y - vis.drawing.h });
    if (!pts.length) {
      this.scale = 40;
      this.ox = this.w / 2;
      this.oy = this.h / 2;
    } else {
      const b = bounds(pts);
      const pad = 1.5;
      const bw = b.maxX - b.minX + 2 * pad, bh = b.maxY - b.minY + 2 * pad;
      this.scale = clamp(Math.min(this.w / bw, this.h / bh), 2, 3000);
      this.ox = this.w / 2 - ((b.minX + b.maxX) / 2) * this.scale;
      this.oy = this.h / 2 + ((b.minY + b.maxY) / 2) * this.scale;
    }
    this.draw();
  }

  onDown(e) {
    this.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      this.pan = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy, button: e.button, moved: false };
      return;
    }
    if (e.button === 0 && this.app.walk?.active) {
      this.app.walk.teleport(this.evt(e).world, this.app.activeLevelId);
      return;
    }
    if (e.button === 0) this.app.tool.pointerDown(this.evt(e));
  }

  onMove(e) {
    const ev = this.evt(e);
    this.app.emit('cursor', ev.world);
    if (this.pan) {
      const dx = e.clientX - this.pan.x, dy = e.clientY - this.pan.y;
      if (Math.hypot(dx, dy) > 3) this.pan.moved = true;
      this.ox = this.pan.ox + dx;
      this.oy = this.pan.oy + dy;
      this.draw();
      return;
    }
    if (this.app.walk?.active) return;
    this.app.tool.pointerMove(ev);
  }

  onUp(e) {
    if (this.pan) {
      const p = this.pan;
      this.pan = null;
      if (p.button === 2 && !p.moved) this.app.cancel();
      return;
    }
    if (e.button === 0 && !this.app.walk?.active) this.app.tool.pointerUp(this.evt(e));
  }

  onWheel(e) {
    e.preventDefault();
    const { sx, sy } = this.evt(e);
    const before = this.toWorld(sx, sy);
    this.scale = clamp(this.scale * Math.exp(-e.deltaY * 0.0015), 2, 3000);
    this.ox = sx - before.x * this.scale;
    this.oy = sy + before.y * this.scale;
    this.draw();
  }

  pickAll(p) { return pickCandidates(this.app, this, p); }
  pick(p) { return this.pickAll(p)[0] ?? null; }
  pickRect(a, b, crossing) { return pickInRect(this.app, a, b, crossing); }

  draw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  render() {
    if (!this.w) return;
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.w, this.h);
    if (this.app.viewSettings.showGrid) this.drawBackgroundGrid();
    const vis = planVisibility(this.app);
    drawModel(ctx, this, this.app, vis);
    this.app.tool.drawOverlay(ctx, this, vis);
    drawNorthArrow(ctx, this.w, this.app.doc.site);
    this.app.walk?.drawPlanMarker(ctx, this);
  }

  drawBackgroundGrid() {
    const { ctx } = this;
    const tl = this.toWorld(0, 0), br = this.toWorld(this.w, this.h);
    const drawStep = (step, color) => {
      if (step * this.scale < 10) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
        const s = Math.round(this.ox + x * this.scale) + 0.5;
        ctx.moveTo(s, 0);
        ctx.lineTo(s, this.h);
      }
      for (let y = Math.floor(br.y / step) * step; y <= tl.y; y += step) {
        const s = Math.round(this.oy - y * this.scale) + 0.5;
        ctx.moveTo(0, s);
        ctx.lineTo(this.w, s);
      }
      ctx.stroke();
    };
    drawStep(1, '#f3f5f7');
    drawStep(5, '#e6eaee');
  }
}
