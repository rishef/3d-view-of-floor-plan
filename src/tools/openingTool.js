import { Tool } from './tool.js';
import { sub, dot, clamp, roundTo, projectOnSegment } from '../core/geom.js';
import { wallPoint } from '../core/regen.js';
import { planVisibility, drawOpening, COLORS } from '../views/planRender.js';
import { drawTempDim, strokePoly } from '../views/overlay.js';

/** Place Door / Place Window: hosted on the wall under the cursor; the cursor side sets the swing. */
export class OpeningTool extends Tool {
  constructor(app, kind) {
    super(app);
    this.kind = kind;
    this.preview = null;
    this.flipHand = false;
  }

  get category() { return this.kind; }
  get title() { return `Modify | Place ${this.kind}`; }
  get hint() {
    return this.kind === 'Door'
      ? 'Hover over a wall and click to place a door · the cursor side sets the swing · Space flips the hinge'
      : 'Hover over a wall and click to place a window';
  }

  deactivate() {
    this.preview = null;
  }

  pointerMove(e) {
    this.preview = this.compute(e.world);
    this.redraw();
  }

  compute(p) {
    const app = this.app;
    const view = app.planView;
    const type = app.doc.type(app.typeFor(this.kind));
    if (!type) return null;
    let best = null;
    for (const f of planVisibility(app).walls) {
      const pr = projectOnSegment(p, f.a, f.b);
      if (pr.dist <= f.t / 2 + 14 / view.scale && (!best || pr.dist < best.pr.dist)) best = { f, pr };
    }
    if (!best) return null;
    const { f, pr } = best;
    const half = type.width / 2;
    const lo = Math.max(f.uSL, f.uSR) + half, hi = Math.min(f.uEL, f.uER) - half;
    let u = pr.t * f.L;
    const mid = (Math.max(f.uSL, f.uSR) + Math.min(f.uEL, f.uER)) / 2;
    u = Math.abs(u - mid) * view.scale < 8 ? mid : roundTo(u, 0.05);
    u = clamp(u, lo, Math.max(lo, hi));
    const side = dot(sub(p, pr.point), f.n) >= 0 ? 1 : -1;
    const z0 = this.kind === 'Door' ? 0 : type.defaultSill ?? 0.9;
    const op = {
      kind: this.kind, host: f, type, u0: u - half, u1: u + half, z0, z1: z0 + type.height,
      el: { flipFacing: side < 0, flipHand: this.flipHand },
    };
    const overlaps = f.openings.some((o) => o.valid && o.u0 < op.u1 - 1e-6 && o.u1 > op.u0 + 1e-6);
    let problem = null;
    if (hi < lo) problem = 'The wall is too short for this type';
    else if (overlaps) problem = 'Overlaps an existing opening';
    else if (op.z1 > f.H - 0.01) problem = 'Taller than the wall';
    return { op, u, problem };
  }

  pointerDown(e) {
    const pv = this.compute(e.world);
    if (!pv) {
      this.app.status(`Place the ${this.kind.toLowerCase()} on a wall`, 'warn');
      return;
    }
    if (pv.problem) {
      this.app.status(`Can't place here: ${pv.problem}`, 'warn');
      return;
    }
    const app = this.app;
    const type = pv.op.type;
    app.doc.transact(`Place ${this.kind}`, () => {
      const el = {
        category: this.kind, typeId: type.id, hostId: pv.op.host.id, t: pv.u,
        mark: app.nextMark(this.kind), comments: '',
      };
      if (this.kind === 'Door') Object.assign(el, { flipFacing: pv.op.el.flipFacing, flipHand: this.flipHand });
      else el.sill = type.defaultSill ?? 0.9;
      app.doc.add(el);
    });
    this.preview = this.compute(e.world);
  }

  keyDown(ev) {
    if (ev.key === ' ' && this.kind === 'Door') {
      this.flipHand = !this.flipHand;
      if (this.preview) this.preview.op.el.flipHand = this.flipHand;
      this.redraw();
      return true;
    }
    return false;
  }

  drawOverlay(ctx, view) {
    const pv = this.preview;
    if (!pv) return;
    const { op } = pv;
    const f = op.host, h = f.t / 2;
    const color = pv.problem ? COLORS.warn : COLORS.sel;
    strokePoly(ctx, view, [wallPoint(f, op.u0, h), wallPoint(f, op.u1, h), wallPoint(f, op.u1, -h), wallPoint(f, op.u0, -h)], {
      stroke: color, fill: pv.problem ? 'rgba(214,54,60,0.15)' : 'rgba(255,255,255,0.85)', width: 1,
    });
    drawOpening(ctx, view, op, color);
    // Temporary dimensions to the clear ends of the wall
    const side = op.el.flipFacing ? 1 : -1;
    const startU = Math.max(f.uSL, f.uSR), endU = Math.min(f.uEL, f.uER);
    const off = side * (h + 0.05);
    if (op.u0 - startU > 0.01) drawTempDim(ctx, view, wallPoint(f, startU, off), wallPoint(f, op.u0, off), -side * 14, `${Math.round((op.u0 - startU) * 1000)}`);
    if (endU - op.u1 > 0.01) drawTempDim(ctx, view, wallPoint(f, op.u1, off), wallPoint(f, endU, off), -side * 14, `${Math.round((endU - op.u1) * 1000)}`);
  }

  renderOptions(el) {
    el.innerHTML = `<span class="opt-title">${this.title}</span>
      <span class="opt-note">${this.kind === 'Door' ? 'Swing follows the cursor side · Space flips the hinge' : 'Sill height comes from the type; change it per window in Properties'}</span>`;
  }
}
