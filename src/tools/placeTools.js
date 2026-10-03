import { Tool } from './tool.js';
import { dist, copyPt, sub } from '../core/geom.js';
import { regionAt } from '../core/rooms.js';
import { columnCorners } from '../core/regen.js';
import { snap } from '../views/snapping.js';
import { drawGrid } from '../views/planRender.js';
import { drawSnapMarker, drawTempDim, strokePoly, drawLabel } from '../views/overlay.js';

/** Structural Column: click to place; snaps to grid intersections. Space rotates 90°. */
export class ColumnTool extends Tool {
  constructor(app) {
    super(app);
    this.rotation = 0;
    this.cur = null;
  }

  get category() { return 'Column'; }
  get title() { return 'Modify | Place Structural Column'; }
  get hint() { return 'Click to place a column (snaps to grid intersections) · Space rotates 90°'; }

  deactivate() { this.cur = null; this.snapInfo = null; }

  pointerMove(e) {
    this.snapInfo = snap(this.app, this.app.planView, e.world, { lines: false });
    this.cur = this.snapInfo.p;
    this.redraw();
  }

  pointerDown(e) {
    this.pointerMove(e);
    const app = this.app;
    const above = app.levelAbove(app.activeLevelId);
    app.doc.transact('Place Column', () => {
      app.doc.add({
        category: 'Column', typeId: app.typeFor('Column'), levelId: app.activeLevelId, topLevelId: above?.id ?? null,
        baseOffset: 0, height: 3, x: this.cur.x, y: this.cur.y, rotation: this.rotation, mark: '', comments: '',
      });
    });
  }

  keyDown(ev) {
    if (ev.key !== ' ') return false;
    this.rotation = (this.rotation + 90) % 360;
    this.redraw();
    return true;
  }

  drawOverlay(ctx, view) {
    if (!this.cur) return;
    const type = this.app.doc.type(this.app.typeFor('Column'));
    if (type) {
      const c = { x: this.cur.x, y: this.cur.y, w: type.width, dd: type.depth, rot: this.rotation };
      strokePoly(ctx, view, columnCorners(c), { fill: 'rgba(10,108,255,0.25)' });
    }
    drawSnapMarker(ctx, view, this.snapInfo);
  }
}

/** Room: click inside an enclosed region; the boundary, area and perimeter are computed from walls. */
export class RoomTool extends Tool {
  constructor(app) {
    super(app);
    this.region = null;
    this.cur = null;
  }

  get title() { return 'Modify | Place Room'; }
  get hint() { return 'Click inside an area enclosed by walls to place a room (boundaries update automatically when walls move)'; }

  deactivate() { this.region = null; }

  pointerMove(e) {
    this.cur = e.world;
    this.region = regionAt(this.app.model.graphFor(this.app.activeLevelId), e.world);
    this.redraw();
  }

  pointerDown(e) {
    const app = this.app;
    const region = regionAt(app.model.graphFor(app.activeLevelId), e.world);
    if (!region) {
      app.status('This spot is not enclosed by walls — rooms need a closed boundary', 'warn');
      return;
    }
    const taken = [...app.model.rooms.entries()].find(([id, r]) => r?.face === region.face && app.doc.get(id)?.levelId === app.activeLevelId);
    if (taken) {
      app.status(`Room ${app.doc.get(taken[0]).number} already occupies this space`, 'warn');
      return;
    }
    app.doc.transact('Place Room', () => {
      app.doc.add({
        category: 'Room', levelId: app.activeLevelId, x: e.world.x, y: e.world.y,
        number: app.nextRoomNumber(app.activeLevelId), name: 'Room', department: '', comments: '',
      });
    });
    app.status(`Room placed: ${region.area.toFixed(2)} m². Rename it in Properties or in the Room Schedule.`);
  }

  drawOverlay(ctx, view) {
    if (!this.region || !this.cur) return;
    strokePoly(ctx, view, this.region.outer, { fill: 'rgba(10,108,255,0.12)', dash: [6, 3] });
    for (const h of this.region.holes) strokePoly(ctx, view, h, { dash: [6, 3] });
    const s = view.toScreen(this.cur);
    drawLabel(ctx, s.x + 14, s.y + 16, `${this.region.area.toFixed(2)} m²`, { align: 'left' });
  }
}

/** Grid: two clicks. Vertical grids are numbered, horizontal grids are lettered. */
export class GridTool extends Tool {
  constructor(app) {
    super(app);
    this.start = null;
    this.cur = null;
  }

  get title() { return 'Modify | Place Grid'; }
  get hint() { return this.start ? 'Click the end of the grid line' : 'Click the start of a grid line'; }

  activate() { this.start = null; }
  deactivate() { this.start = null; this.snapInfo = null; }

  cancel() {
    if (!this.start) return false;
    this.start = null;
    this.redraw();
    return true;
  }

  pointerMove(e) {
    this.snapInfo = snap(this.app, this.app.planView, e.world, { anchor: this.start, ortho: e.shift });
    this.cur = this.snapInfo.p;
    this.redraw();
  }

  pointerDown(e) {
    this.pointerMove(e);
    if (!this.start) {
      this.start = this.cur;
      this.app.status(this.hint);
      return;
    }
    if (dist(this.start, this.cur) < 0.5) return;
    const app = this.app;
    const d = sub(this.cur, this.start);
    const name = app.nextGridName(Math.abs(d.y) > Math.abs(d.x));
    const a = copyPt(this.start), b = copyPt(this.cur);
    app.doc.transact('Create Grid', () => app.doc.add({ category: 'Grid', a, b, name }));
    this.start = null;
    app.status(`Grid ${name} created`);
  }

  drawOverlay(ctx, view) {
    if (this.start && this.cur && dist(this.start, this.cur) > 1e-3) {
      const d = sub(this.cur, this.start);
      drawGrid(ctx, view, { a: this.start, b: this.cur, name: this.app.nextGridName(Math.abs(d.y) > Math.abs(d.x)) }, '#0a6cff');
      drawTempDim(ctx, view, this.start, this.cur, -26, `${Math.round(dist(this.start, this.cur) * 1000)}`);
    }
    drawSnapMarker(ctx, view, this.snapInfo);
  }
}
