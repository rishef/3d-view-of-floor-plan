// Transient plan graphics drawn by tools: snap markers, temporary dimensions, rubber bands.

import { add, sub, mul, norm, dist } from '../core/geom.js';
import { COLORS } from './planRender.js';

const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

export function drawSnapMarker(ctx, view, snap) {
  if (!snap) return;
  const s = view.toScreen(snap.p);
  ctx.save();
  ctx.strokeStyle = '#0a6cff';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  const r = 6;
  ctx.beginPath();
  switch (snap.kind) {
    case 'endpoint':
      ctx.rect(s.x - r, s.y - r, 2 * r, 2 * r);
      break;
    case 'midpoint':
      ctx.moveTo(s.x, s.y - r);
      ctx.lineTo(s.x + r, s.y + r * 0.8);
      ctx.lineTo(s.x - r, s.y + r * 0.8);
      ctx.closePath();
      break;
    case 'intersection':
      ctx.moveTo(s.x - r, s.y - r); ctx.lineTo(s.x + r, s.y + r);
      ctx.moveTo(s.x + r, s.y - r); ctx.lineTo(s.x - r, s.y + r);
      break;
    case 'nearest':
      ctx.moveTo(s.x - r, s.y - r); ctx.lineTo(s.x + r, s.y - r);
      ctx.lineTo(s.x - r, s.y + r); ctx.lineTo(s.x + r, s.y + r); ctx.closePath();
      break;
    case 'center':
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      break;
    default:
      ctx.moveTo(s.x - 4, s.y); ctx.lineTo(s.x + 4, s.y);
      ctx.moveTo(s.x, s.y - 4); ctx.lineTo(s.x, s.y + 4);
  }
  ctx.stroke();
  if (snap.guide) {
    const a = view.toScreen(snap.guide.a), b = view.toScreen(snap.guide.b);
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawLabel(ctx, x, y, text, { color = '#0a6cff', bg = 'rgba(255,255,255,0.92)', align = 'center' } = {}) {
  ctx.save();
  ctx.font = `600 11px ${FONT}`;
  const w = ctx.measureText(text).width + 8;
  const left = align === 'left' ? x : x - w / 2;
  ctx.fillStyle = bg;
  ctx.fillRect(left, y - 8, w, 16);
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + 4, y + 0.5);
  ctx.restore();
}

/** Revit-style temporary dimension between two world points, offset to one side. */
export function drawTempDim(ctx, view, a, b, offsetPx, text) {
  const sa = view.toScreen(a), sb = view.toScreen(b);
  if (dist(sa, sb) < 2) return;
  const d = norm(sub(sb, sa));
  const n = { x: -d.y, y: d.x };
  const o = mul(n, offsetPx);
  const pa = add(sa, o), pb = add(sb, o);
  ctx.save();
  ctx.strokeStyle = '#0a6cff';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(sa.x + n.x * 3 * Math.sign(offsetPx), sa.y + n.y * 3 * Math.sign(offsetPx));
  ctx.lineTo(pa.x + n.x * 4 * Math.sign(offsetPx), pa.y + n.y * 4 * Math.sign(offsetPx));
  ctx.moveTo(sb.x + n.x * 3 * Math.sign(offsetPx), sb.y + n.y * 3 * Math.sign(offsetPx));
  ctx.lineTo(pb.x + n.x * 4 * Math.sign(offsetPx), pb.y + n.y * 4 * Math.sign(offsetPx));
  ctx.moveTo(pa.x, pa.y);
  ctx.lineTo(pb.x, pb.y);
  for (const p of [pa, pb]) {
    ctx.moveTo(p.x - (d.x + n.x) * 4, p.y - (d.y + n.y) * 4);
    ctx.lineTo(p.x + (d.x + n.x) * 4, p.y + (d.y + n.y) * 4);
  }
  ctx.stroke();
  const mid = mul(add(pa, pb), 0.5);
  ctx.translate(mid.x, mid.y);
  let ang = Math.atan2(d.y, d.x);
  if (ang > Math.PI / 2) ang -= Math.PI;
  if (ang <= -Math.PI / 2) ang += Math.PI;
  ctx.rotate(ang);
  drawLabel(ctx, 0, 0, text);
  ctx.restore();
}

export function strokePoly(ctx, view, pts, { stroke = COLORS.sel, fill = null, dash = [], width = 1.5, close = true } = {}) {
  if (!pts.length) return;
  ctx.save();
  ctx.beginPath();
  pts.forEach((p, i) => {
    const s = view.toScreen(p);
    if (i) ctx.lineTo(s.x, s.y);
    else ctx.moveTo(s.x, s.y);
  });
  if (close) ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill('evenodd');
  }
  ctx.setLineDash(dash);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}
