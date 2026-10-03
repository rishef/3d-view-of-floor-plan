// Wall detection on raster floor plans.
//
// 1. Binarise the drawing (dark ink = 1).
// 2. Morphology isolates wall bodies:
//    - "filled" plans (solid/poché walls): an opening removes text, dimensions and other thin lines;
//    - "outlined" plans (double-line or hatched walls): a directional closing bridges the two wall
//      lines first, then the same opening removes thin linework.
// 3. Row/column band scanning turns the mask into horizontal/vertical wall rectangles.
// 4. Each rectangle is validated against the original ink, and in outlined plans windows are found
//    as stretches of wall whose cross-section shows extra parallel (glazing) lines.
//
// All results are in image pixels; scaling and clean-up happen later.

const odd = (n) => (n % 2 ? n : n + 1);

export function binarize(gray, threshold) {
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] < threshold ? 1 : 0;
  return out;
}

/** 1D box erosion/dilation along rows (horizontal) or columns, via a sliding count. */
function morph1D(src, w, h, k, horizontal, dilate) {
  if (k <= 1) return src;
  const out = new Uint8Array(w * h);
  const r = k >> 1;
  const lines = horizontal ? h : w, len = horizontal ? w : h;
  const stride = horizontal ? 1 : w;
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * w : line;
    let count = 0;
    for (let i = 0; i < Math.min(r, len); i++) count += src[base + i * stride];
    for (let i = 0; i < len; i++) {
      const add = i + r;
      if (add < len) count += src[base + add * stride];
      const rem = i - r - 1;
      if (rem >= 0) count -= src[base + rem * stride];
      const size = Math.min(len - 1, i + r) - Math.max(0, i - r) + 1;
      out[base + i * stride] = dilate ? (count > 0 ? 1 : 0) : (count === size ? 1 : 0);
    }
  }
  return out;
}

const erode = (m, w, h, kx, ky) => morph1D(morph1D(m, w, h, kx, true, false), w, h, ky, false, false);
const dilate = (m, w, h, kx, ky) => morph1D(morph1D(m, w, h, kx, true, true), w, h, ky, false, true);
export const opening = (m, w, h, kx, ky = kx) => dilate(erode(m, w, h, kx, ky), w, h, kx, ky);
export const closing = (m, w, h, kx, ky = kx) => erode(dilate(m, w, h, kx, ky), w, h, kx, ky);

function transpose(m, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x * h + y] = m[y * w + x];
  return out;
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[s.length >> 1];
};

/** Groups long horizontal runs in consecutive rows into bands: {x0, x1, y0, y1} (inclusive). */
function scanBands(mask, w, h, minLen) {
  let active = [];
  const done = [];
  for (let y = 0; y < h; y++) {
    const runs = [];
    const o = y * w;
    let x = 0;
    while (x < w) {
      if (!mask[o + x]) { x++; continue; }
      const s = x;
      while (x < w && mask[o + x]) x++;
      if (x - s >= minLen) runs.push([s, x - 1]);
    }
    const used = new Array(runs.length).fill(false);
    const next = [];
    for (const b of active) {
      let best = -1, bestOv = 0;
      for (let i = 0; i < runs.length; i++) {
        if (used[i]) continue;
        const [s, e] = runs[i];
        const ov = Math.min(e, b.bx1) - Math.max(s, b.bx0) + 1;
        if (ov / Math.max(e - s + 1, b.bx1 - b.bx0 + 1) > 0.8 && ov > bestOv) { best = i; bestOv = ov; }
      }
      if (best >= 0) {
        used[best] = true;
        b.x0s.push(runs[best][0]);
        b.x1s.push(runs[best][1]);
        b.y1 = y;
        next.push(b);
      } else {
        done.push(b);
      }
    }
    runs.forEach(([s, e], i) => { if (!used[i]) next.push({ x0s: [s], x1s: [e], bx0: s, bx1: e, y0: y, y1: y }); });
    active = next;
  }
  done.push(...active);
  return done.map((b) => ({ x0: median(b.x0s), x1: median(b.x1s), y0: b.y0, y1: b.y1 }));
}

/** Dark-ink fraction inside a rectangle of the original drawing. */
function inkFraction(bin, w, x0, x1, y0, y1) {
  let n = 0, total = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { n += bin[y * w + x]; total++; }
  return total ? n / total : 0;
}

/** Fraction of positions along a band edge that have ink within `depth` px of that edge. */
function edgeCoverage(bin, w, x0, x1, yFrom, yTo) {
  let hit = 0;
  for (let x = x0; x <= x1; x++) {
    for (let y = yFrom; y <= yTo; y++) if (bin[y * w + x]) { hit++; break; }
  }
  return hit / Math.max(1, x1 - x0 + 1);
}

/** Starts of ink runs across a wall's thickness at one position along it. */
function crossSection(bin, w, h, x, y0, y1) {
  const starts = [];
  let inside = false;
  for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
    const v = bin[y * w + x];
    if (v && !inside) starts.push(y);
    inside = !!v;
  }
  return starts;
}

/** Average stroke width of the two face lines of an outlined wall (so thickness is face-to-face). */
function faceLineWidth(bin, w, h, r) {
  let sum = 0, n = 0;
  for (let k = 1; k <= 9; k++) {
    const x = Math.round(r.x0 + ((r.x1 - r.x0) * k) / 10);
    const runs = [];
    let start = -1;
    for (let y = Math.max(0, r.y0 - 1); y <= Math.min(h - 1, r.y1 + 1) + 1; y++) {
      const v = y <= Math.min(h - 1, r.y1 + 1) ? bin[y * w + x] : 0;
      if (v && start < 0) start = y;
      if (!v && start >= 0) { runs.push(y - start); start = -1; }
    }
    if (runs.length >= 2) { sum += runs[0] + runs[runs.length - 1]; n += 2; }
  }
  return n ? sum / n : 0;
}

const sameSig = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 1);

/** Windows inside an outlined wall: ≥3 parallel lines in the cross-section that stay put along the wall. */
function profileWindows(bin, w, h, r, minWinPx) {
  const out = [];
  let start = -1;
  const sig = (x) => crossSection(bin, w, h, x, r.y0 - 1, r.y1 + 1);
  for (let x = r.x0 + 3; x <= r.x1 + 1; x++) {
    const s = x <= r.x1 ? sig(x) : [];
    const isWin = s.length >= 3 && sameSig(s, sig(x - 3));
    if (isWin && start < 0) start = x;
    if (!isWin && start >= 0) {
      if (x - start >= minWinPx) out.push({ x0: start - 2, x1: x + 1 });
      start = -1;
    }
  }
  return out;
}

/**
 * gray: Uint8Array luminance, w×h. opts (pixels): threshold, mode ('auto' | 'filled' | 'outlined'),
 * minThickPx, maxThickPx, minLenPx, minWinPx.
 * Returns { mode, walls: [{ a, b, t }], windows: [{ center, width, horizontal }], bin }.
 */
export function detectRaster(gray, w, h, opts) {
  const bin = binarize(gray, opts.threshold);
  const kOpen = odd(Math.max(3, Math.round(opts.minThickPx * 0.75)));
  const kClose = odd(Math.max(3, Math.round(opts.maxThickPx * 1.15)));
  const tMin = opts.minThickPx * 0.7, tMax = opts.maxThickPx * 1.15;

  const run = (mode) => {
    let mH, mV;
    if (mode === 'filled') {
      mH = mV = opening(bin, w, h, kOpen, kOpen);
    } else {
      mH = opening(closing(bin, w, h, 1, kClose), w, h, kOpen, kOpen);
      mV = opening(closing(bin, w, h, kClose, 1), w, h, kOpen, kOpen);
    }
    const rects = [];
    const accept = (r, horizontal) => {
      const t = r.y1 - r.y0 + 1, L = r.x1 - r.x0 + 1;
      if (t < tMin || t > tMax || L < Math.max(opts.minLenPx, 1.5 * t)) return;
      // validate against the original ink, in the band's own (row-major) frame
      const src = horizontal ? bin : binT;
      const sw = horizontal ? w : h;
      if (mode === 'filled') {
        if (inkFraction(src, sw, r.x0, r.x1, r.y0, r.y1) < 0.5) return;
      } else {
        const depth = Math.max(2, Math.round(t * 0.25));
        if (edgeCoverage(src, sw, r.x0, r.x1, r.y0, r.y0 + depth) < 0.6) return;
        if (edgeCoverage(src, sw, r.x0, r.x1, r.y1 - depth, r.y1) < 0.6) return;
      }
      rects.push({ ...r, horizontal, t, L });
    };
    for (const r of scanBands(mH, w, h, opts.minLenPx)) accept(r, true);
    for (const r of scanBands(transpose(mV, w, h), h, w, opts.minLenPx)) accept(r, false);
    return { mode, rects, total: rects.reduce((s, r) => s + r.L, 0) };
  };

  const binT = transpose(bin, w, h);
  let result;
  if (opts.mode === 'filled' || opts.mode === 'outlined') result = run(opts.mode);
  else {
    const filled = run('filled');
    const outlined = run('outlined');
    result = filled.total >= 0.6 * outlined.total ? filled : outlined;
  }

  if (result.mode === 'outlined') {
    for (const r of result.rects) {
      const src = r.horizontal ? bin : binT;
      const lw = faceLineWidth(src, r.horizontal ? w : h, r.horizontal ? h : w, r);
      r.t = Math.max(1, r.t - lw);
    }
  }

  const walls = result.rects.map((r) => {
    const c = (r.y0 + r.y1 + 1) / 2;
    return r.horizontal
      ? { a: { x: r.x0, y: c }, b: { x: r.x1 + 1, y: c }, t: r.t }
      : { a: { x: c, y: r.x0 }, b: { x: c, y: r.x1 + 1 }, t: r.t };
  });

  const windows = [];
  if (result.mode === 'outlined') {
    for (const r of result.rects) {
      const src = r.horizontal ? bin : binT;
      const sw = r.horizontal ? w : h, sh = r.horizontal ? h : w;
      for (const win of profileWindows(src, sw, sh, r, opts.minWinPx)) {
        const c = (r.y0 + r.y1 + 1) / 2, m = (win.x0 + win.x1 + 1) / 2;
        windows.push({ center: r.horizontal ? { x: m, y: c } : { x: c, y: m }, width: win.x1 - win.x0 + 1, horizontal: r.horizontal });
      }
    }
  }
  return { mode: result.mode, walls, windows, bin };
}

/** Typical (thicker) wall thickness in px, weighted by length — used to guess the drawing scale. */
export function dominantThickness(walls) {
  if (!walls.length) return null;
  const items = walls.map((w) => ({ t: w.t, L: Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) })).sort((p, q) => p.t - q.t);
  const total = items.reduce((s, i) => s + i.L, 0);
  let acc = 0;
  for (const i of items) {
    acc += i.L;
    if (acc >= total * 0.7) return i.t;
  }
  return items[items.length - 1].t;
}

/** Classifies an opening gap from the raster: ≥2 parallel lines across most of it = window. */
export function rasterGapClassifier(bin, w, h, toPx, pxPerM) {
  return (p0, p1, t) => {
    const a = toPx(p0), b = toPx(p1);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 2) return 'Door';
    const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len;
    const half = (t * pxPerM) / 2 + 1;
    let windowish = 0, samples = 0;
    for (let i = 1; i < 20; i++) {
      const cx = a.x + (b.x - a.x) * (i / 20), cy = a.y + (b.y - a.y) * (i / 20);
      let runs = 0, inside = false;
      for (let s = -half; s <= half; s += 0.5) {
        const x = Math.round(cx - dy * s), y = Math.round(cy + dx * s);
        const v = x >= 0 && y >= 0 && x < w && y < h ? bin[y * w + x] : 0;
        if (v && !inside) runs++;
        inside = !!v;
      }
      samples++;
      if (runs >= 2) windowish++;
    }
    return windowish / samples >= 0.5 ? 'Window' : 'Door';
  };
}
