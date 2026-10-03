import { Tool } from './tool.js';
import { add, sub, dist, clamp, roundTo, projectOnSegment, near, copyPt } from '../core/geom.js';
import { translateElement, computeFollowers, applyFollowers } from '../core/edit.js';
import { snap } from '../views/snapping.js';
import { planVisibility, gripsFor } from '../views/planRender.js';
import { drawSnapMarker, drawTempDim } from '../views/overlay.js';
import { columnCorners } from '../core/regen.js';

/**
 * Modify tool: click / Tab-cycle selection, window & crossing box selection,
 * drag to move (joined walls stretch to follow), endpoint grips, door sliding along walls.
 */
export class SelectTool extends Tool {
  constructor(app) {
    super(app);
    this.state = null;
    this.cands = [];
    this.cycle = 0;
  }

  get title() { return 'Modify'; }
  get hint() {
    return 'Click to select · Tab cycles overlapping elements · drag to move · drag empty space to box-select (→ inside, ← crossing) · Del deletes';
  }

  deactivate() {
    if (this.state && (this.state.mode === 'move' || this.state.mode === 'grip')) this.app.doc.rollback();
    this.state = null;
    this.snapInfo = null;
  }

  cancel() {
    if (!this.state) return false;
    if (this.state.mode === 'move' || this.state.mode === 'grip') this.app.doc.rollback();
    this.state = null;
    this.snapInfo = null;
    this.redraw();
    return true;
  }

  gripAt(e) {
    if (this.app.selection.size !== 1) return null;
    const view = this.app.planView;
    const id = [...this.app.selection][0];
    for (const g of gripsFor(this.app, id)) {
      const s = view.toScreen(g.p);
      if (Math.hypot(s.x - e.sx, s.y - e.sy) <= 7) return g;
    }
    return null;
  }

  pointerDown(e) {
    const grip = this.gripAt(e);
    if (grip) {
      this.beginGrip(grip, e);
      return;
    }
    const hover = this.app.hoverId;
    const id = hover && this.cands.includes(hover) ? hover : this.app.planView.pick(e.world);
    if (id) {
      if (e.shift || e.ctrl) {
        this.app.select([id], 'toggle');
        return;
      }
      if (!this.app.selection.has(id)) this.app.select([id]);
      this.state = { mode: 'pending', id, sx: e.sx, sy: e.sy, start: e.world };
    } else {
      this.state = { mode: 'box', sx: e.sx, sy: e.sy, start: e.world, cur: e.world, additive: e.shift || e.ctrl };
    }
  }

  pointerMove(e) {
    const s = this.state;
    if (!s) {
      this.cands = this.app.planView.pickAll(e.world);
      this.cycle = 0;
      const g = this.gripAt(e);
      this.app.planView.canvas.style.cursor = g ? 'move' : this.cands.length ? 'pointer' : 'default';
      this.app.setHover(this.cands[0] ?? null);
      return;
    }
    if (s.mode === 'pending') {
      if (Math.hypot(e.sx - s.sx, e.sy - s.sy) < 4) return;
      this.beginMove(s);
    }
    if (s.mode === 'move') this.updateMove(e);
    else if (s.mode === 'grip') this.updateGrip(e);
    else if (s.mode === 'box') {
      s.cur = e.world;
      this.redraw();
    }
  }

  pointerUp(e) {
    const s = this.state;
    this.state = null;
    this.snapInfo = null;
    if (!s) return;
    if (s.mode === 'move' || s.mode === 'grip') {
      this.app.doc.commit();
    } else if (s.mode === 'box') {
      if (Math.hypot(e.sx - s.sx, e.sy - s.sy) < 4) {
        if (!s.additive) this.app.clearSelection();
      } else {
        const crossing = e.world.x < s.start.x;
        this.app.select(this.app.planView.pickRect(s.start, e.world, crossing), s.additive ? 'add' : 'replace');
      }
    }
    this.redraw();
  }

  keyDown(ev) {
    if (ev.key === 'Tab' && !this.state && this.cands.length > 1) {
      this.cycle = (this.cycle + 1) % this.cands.length;
      this.app.setHover(this.cands[this.cycle]);
      const el = this.app.doc.get(this.cands[this.cycle]);
      this.app.status(`Tab: ${el?.category} ${el?.mark || el?.name || el?.number || ''} (${this.cycle + 1}/${this.cands.length})`);
      return true;
    }
    if (ev.key === ' ' && this.app.selection.size) {
      const doors = [...this.app.selection].map((id) => this.app.doc.get(id)).filter((el) => el?.category === 'Door');
      if (!doors.length) return false;
      this.app.doc.transact('Flip Door', () => {
        for (const d of doors) {
          // cycle through the four swing orientations
          if (!d.flipFacing && !d.flipHand) d.flipFacing = true;
          else if (d.flipFacing && !d.flipHand) d.flipHand = true;
          else if (d.flipFacing && d.flipHand) d.flipFacing = false;
          else d.flipHand = false;
        }
      });
      return true;
    }
    return false;
  }

  // ---- move ----------------------------------------------------------------------
  beginMove(s) {
    const doc = this.app.doc;
    const el = doc.get(s.id);
    doc.begin('Move');
    s.mode = 'move';
    s.orig = new Map([...this.app.selection].map((id) => [id, structuredClone(doc.get(id))]));
    s.slide = this.app.selection.size === 1 && (el.category === 'Door' || el.category === 'Window');
    s.followers = s.slide ? [] : computeFollowers(doc, new Set(s.orig.keys()));
    s.ref = referencePoint(this.app, el, s.start);
    s.exclude = new Set([...s.orig.keys(), ...s.followers.map((f) => f.id)]);
  }

  updateMove(e) {
    const s = this.state;
    const doc = this.app.doc;
    if (s.slide) {
      this.slideOpening(e);
      return;
    }
    const target = add(s.ref, sub(e.world, s.start));
    this.snapInfo = snap(this.app, this.app.planView, target, { exclude: s.exclude, lines: false });
    const delta = sub(this.snapInfo.p, s.ref);
    for (const [id, orig] of s.orig) {
      const el = doc.get(id);
      if (el) translateElement(el, orig, delta);
    }
    applyFollowers(doc, s.followers, delta);
    s.delta = delta;
    doc.notify();
  }

  slideOpening(e) {
    const app = this.app;
    const doc = app.doc;
    const el = doc.get(this.state.id);
    const type = doc.type(el.typeId);
    const view = app.planView;
    let best = null;
    for (const f of planVisibility(app).walls) {
      const pr = projectOnSegment(e.world, f.a, f.b);
      const reach = f.t / 2 + 25 / view.scale;
      if (pr.dist <= reach && (!best || pr.dist < best.pr.dist)) best = { f, pr };
    }
    if (!best) {
      const f = app.model.walls.get(el.hostId);
      if (!f) return;
      best = { f, pr: projectOnSegment(e.world, f.a, f.b) };
    }
    const { f, pr } = best;
    const half = type.width / 2;
    const lo = Math.max(f.uSL, f.uSR) + half, hi = Math.min(f.uEL, f.uER) - half;
    el.hostId = f.id;
    el.t = hi >= lo ? clamp(roundTo(pr.t * f.L, 0.01), lo, hi) : f.L / 2;
    doc.notify();
  }

  // ---- grips -----------------------------------------------------------------------
  beginGrip(g, e) {
    const doc = this.app.doc;
    const el = doc.get(g.id);
    doc.begin('Drag Endpoint');
    const followers = [];
    if (el.category === 'Wall') {
      for (const w of doc.byCategory('Wall')) {
        if (w.id === el.id || w.levelId !== el.levelId) continue;
        for (const end of ['a', 'b']) if (near(w[end], g.p, 1e-3)) followers.push({ id: w.id, end });
      }
    }
    this.state = { mode: 'grip', grip: g, followers, exclude: new Set([el.id, ...followers.map((f) => f.id)]), start: e.world };
  }

  updateGrip(e) {
    const s = this.state;
    const doc = this.app.doc;
    const el = doc.get(s.grip.id);
    if (!el) return;
    let anchor = null;
    if (el.category === 'Wall' || el.category === 'Grid') anchor = s.grip.key === 'a' ? el.b : el.a;
    else if (el.category === 'Floor') {
      const n = el.boundary.length;
      anchor = el.boundary[(s.grip.key - 1 + n) % n];
    }
    this.snapInfo = snap(this.app, this.app.planView, e.world, { anchor, exclude: s.exclude, ortho: e.shift });
    const p = this.snapInfo.p;
    if (el.category === 'Floor') el.boundary[s.grip.key] = copyPt(p);
    else el[s.grip.key] = copyPt(p);
    for (const f of s.followers) doc.get(f.id)[f.end] = copyPt(p);
    doc.notify();
  }

  // ---- overlay ---------------------------------------------------------------------
  drawOverlay(ctx, view) {
    const s = this.state;
    if (s?.mode === 'box') {
      const a = view.toScreen(s.start), b = view.toScreen(s.cur);
      const crossing = s.cur.x < s.start.x;
      ctx.save();
      ctx.setLineDash(crossing ? [6, 4] : []);
      ctx.strokeStyle = '#0a6cff';
      ctx.fillStyle = crossing ? 'rgba(40,180,90,0.08)' : 'rgba(10,108,255,0.08)';
      ctx.lineWidth = 1;
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y);
      ctx.restore();
    }
    if (s?.mode === 'grip') {
      const el = this.app.doc.get(s.grip.id);
      if (el?.category === 'Wall') drawTempDim(ctx, view, el.a, el.b, -24, `${Math.round(dist(el.a, el.b) * 1000)}`);
    }
    if (s?.mode === 'move' && s.delta) {
      const moved = Math.hypot(s.delta.x, s.delta.y);
      if (moved > 1e-6) drawTempDim(ctx, view, s.ref, add(s.ref, s.delta), -18, `${Math.round(moved * 1000)}`);
    }
    if (s && (s.mode === 'move' || s.mode === 'grip')) drawSnapMarker(ctx, view, this.snapInfo);
  }
}

/** The characteristic point of an element closest to where it was grabbed. */
function referencePoint(app, el, p) {
  let pts;
  switch (el.category) {
    case 'Wall':
    case 'Grid':
      pts = [el.a, el.b];
      break;
    case 'Floor':
      pts = el.boundary;
      break;
    case 'Column': {
      const c = app.model.columns.get(el.id);
      pts = [{ x: el.x, y: el.y }, ...(c ? columnCorners(c) : [])];
      break;
    }
    case 'Room':
      pts = [{ x: el.x, y: el.y }];
      break;
    default:
      return copyPt(p);
  }
  let best = pts[0];
  for (const q of pts) if (dist(q, p) < dist(best, p)) best = q;
  return copyPt(best);
}
