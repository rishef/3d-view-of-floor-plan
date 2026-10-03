import { Tool } from './tool.js';
import { dist, copyPt, polygonArea, projectOnSegment } from '../core/geom.js';
import { regionAt, outerBoundary } from '../core/rooms.js';
import { snap } from '../views/snapping.js';
import { planVisibility } from '../views/planRender.js';
import { drawSnapMarker, drawTempDim, strokePoly } from '../views/overlay.js';

const MODES = [['walls', 'Pick Walls'], ['room', 'Pick Room'], ['rect', 'Rectangle'], ['poly', 'Polygon']];

/** Create Floor: from the outside faces of a wall loop, from a room, or sketched. */
export class FloorTool extends Tool {
  constructor(app) {
    super(app);
    this.mode = 'walls';
    this.pts = [];
    this.cur = null;
    this.region = null;
  }

  get category() { return 'Floor'; }
  get title() { return 'Modify | Create Floor'; }
  get hint() {
    switch (this.mode) {
      case 'walls': return 'Click a wall: the floor follows the outside faces of its wall loop';
      case 'room': return 'Click inside an enclosed space: the floor fills it to the wall faces';
      case 'rect': return this.pts.length ? 'Click the opposite corner' : 'Click the first corner';
      default: return 'Click boundary points · click the first point, double-click or press Enter to finish · Backspace removes a point';
    }
  }

  activate() { this.reset(); }
  deactivate() { this.reset(); }

  reset() {
    this.pts = [];
    this.region = null;
    this.snapInfo = null;
  }

  cancel() {
    if (!this.pts.length) return false;
    this.reset();
    this.redraw();
    return true;
  }

  findRegion(p) {
    const app = this.app;
    const graph = app.model.graphFor(app.activeLevelId);
    if (this.mode === 'room') {
      const reg = regionAt(graph, p);
      return reg ? reg.outer : null;
    }
    const view = app.planView;
    let best = null;
    for (const f of planVisibility(app).walls) {
      const d = projectOnSegment(p, f.a, f.b).dist - f.t / 2;
      if (d <= 8 / view.scale && (!best || d < best.d)) best = { id: f.id, d };
    }
    return best ? outerBoundary(graph, best.id) : null;
  }

  pointerMove(e) {
    if (this.mode === 'walls' || this.mode === 'room') {
      this.region = this.findRegion(e.world);
      this.redraw();
      return;
    }
    const anchor = this.mode === 'poly' && this.pts.length ? this.pts[this.pts.length - 1] : null;
    this.snapInfo = snap(this.app, this.app.planView, e.world, { anchor, ortho: e.shift });
    this.cur = this.snapInfo.p;
    this.redraw();
  }

  pointerDown(e) {
    if (this.mode === 'walls' || this.mode === 'room') {
      const pts = this.findRegion(e.world);
      if (pts) this.create(pts);
      else this.app.status(this.mode === 'room' ? 'No enclosed space found here' : 'Click on a wall that is part of a closed loop', 'warn');
      return;
    }
    this.pointerMove(e);
    const p = this.cur;
    if (this.mode === 'rect') {
      if (!this.pts.length) {
        this.pts = [p];
      } else {
        const a = this.pts[0];
        if (Math.abs(p.x - a.x) > 0.05 && Math.abs(p.y - a.y) > 0.05) this.create([a, { x: p.x, y: a.y }, p, { x: a.x, y: p.y }]);
        this.pts = [];
      }
      this.app.status(this.hint);
      return;
    }
    const view = this.app.planView;
    if (this.pts.length >= 3 && dist(p, this.pts[0]) * view.scale < 10) {
      this.finishPoly();
      return;
    }
    if (this.pts.length && dist(p, this.pts[this.pts.length - 1]) < 1e-6) return;
    this.pts.push(p);
  }

  doubleClick() {
    if (this.mode === 'poly') this.finishPoly();
  }

  finishPoly() {
    if (this.pts.length >= 3) this.create(this.pts);
    this.pts = [];
  }

  keyDown(ev) {
    if (this.mode !== 'poly' || !this.pts.length) return false;
    if (ev.key === 'Enter') {
      this.finishPoly();
      this.redraw();
      return true;
    }
    if (ev.key === 'Backspace') {
      this.pts.pop();
      this.redraw();
      return true;
    }
    return false;
  }

  create(pts) {
    if (pts.length < 3 || Math.abs(polygonArea(pts)) < 0.01) return;
    const app = this.app;
    app.doc.transact('Create Floor', () => {
      app.doc.add({
        category: 'Floor', typeId: app.typeFor('Floor'), levelId: app.activeLevelId, offset: 0,
        boundary: pts.map(copyPt), mark: '', comments: '',
      });
    });
    this.app.status(`Floor created on ${app.activeLevel.name}`);
  }

  drawOverlay(ctx, view) {
    if ((this.mode === 'walls' || this.mode === 'room') && this.region) {
      strokePoly(ctx, view, this.region, { fill: 'rgba(10,108,255,0.12)', dash: [6, 3], width: 1.5 });
    }
    if (this.mode === 'rect' && this.pts.length && this.cur) {
      const a = this.pts[0], p = this.cur;
      strokePoly(ctx, view, [a, { x: p.x, y: a.y }, p, { x: a.x, y: p.y }], { fill: 'rgba(10,108,255,0.12)' });
      drawTempDim(ctx, view, a, { x: p.x, y: a.y }, -20, `${Math.round(Math.abs(p.x - a.x) * 1000)}`);
      drawTempDim(ctx, view, { x: p.x, y: a.y }, p, -20, `${Math.round(Math.abs(p.y - a.y) * 1000)}`);
    }
    if (this.mode === 'poly' && this.pts.length) {
      const pts = this.cur ? [...this.pts, this.cur] : this.pts;
      strokePoly(ctx, view, pts, { fill: pts.length > 2 ? 'rgba(10,108,255,0.10)' : null, close: false });
      if (this.cur) drawTempDim(ctx, view, this.pts[this.pts.length - 1], this.cur, -20, `${Math.round(dist(this.pts[this.pts.length - 1], this.cur) * 1000)}`);
    }
    drawSnapMarker(ctx, view, this.snapInfo);
  }

  renderOptions(el) {
    el.innerHTML = `<span class="opt-title">${this.title}</span>${Tool.segmented('mode', MODES, this.mode)}`;
    el.querySelector('.seg').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.mode = b.dataset.value;
      this.reset();
      this.renderOptions(el);
      this.app.status(this.hint);
      this.redraw();
    });
  }
}
