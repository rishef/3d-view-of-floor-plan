// Shared editing operations used by tools and commands.

import { add, sub, mul, dot, near, norm, perp, copyPt, projectOnSegment } from './geom.js';

/** Moves an element by delta relative to a snapshot of its original state. */
export function translateElement(el, orig, delta) {
  switch (el.category) {
    case 'Wall':
    case 'Grid':
      el.a = add(orig.a, delta);
      el.b = add(orig.b, delta);
      break;
    case 'Floor':
      el.boundary = orig.boundary.map((p) => add(p, delta));
      break;
    case 'Column':
    case 'Room':
      el.x = orig.x + delta.x;
      el.y = orig.y + delta.y;
      break;
    default:
      break; // hosted elements ride along with their host; levels don't move in plan
  }
}

/**
 * Ends of other walls that must follow when the given walls move, so joins stay intact:
 * corner joins move fully, T-junctions slide only perpendicular to the moving wall.
 */
export function computeFollowers(doc, movingIds) {
  const moving = [...movingIds].map((id) => doc.get(id)).filter((e) => e?.category === 'Wall');
  const followers = [];
  if (!moving.length) return followers;
  for (const w of doc.byCategory('Wall')) {
    if (movingIds.has(w.id)) continue;
    for (const end of ['a', 'b']) {
      const p = w[end];
      for (const m of moving) {
        if (m.levelId !== w.levelId) continue;
        if (near(p, m.a, 1e-3) || near(p, m.b, 1e-3)) {
          followers.push({ id: w.id, end, orig: copyPt(p), n: null });
          break;
        }
        const pr = projectOnSegment(p, m.a, m.b);
        if (pr.dist < 1e-3 && pr.t > 0 && pr.t < 1) {
          followers.push({ id: w.id, end, orig: copyPt(p), n: perp(norm(sub(m.b, m.a))) });
          break;
        }
      }
    }
  }
  return followers;
}

export function applyFollowers(doc, followers, delta) {
  for (const f of followers) {
    const w = doc.get(f.id);
    if (!w) continue;
    w[f.end] = f.n ? add(f.orig, mul(f.n, dot(delta, f.n))) : add(f.orig, delta);
  }
}

/** One-shot move (arrow-key nudge, paste offset). Must run inside a transaction. */
export function moveElements(doc, ids, delta) {
  const set = new Set(ids);
  const followers = computeFollowers(doc, set);
  for (const id of set) {
    const el = doc.get(id);
    if (el) translateElement(el, structuredClone(el), delta);
  }
  applyFollowers(doc, followers, delta);
}
