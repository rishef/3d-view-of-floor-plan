// Draws a realistic-looking raster floor plan (labels, dimensions, door swings, furniture) so the
// importer can be demonstrated and tested without a file. 14 m × 10 m, three bedrooms-ish layout.

const EXT = 0.23, INT = 0.115;

// Walls as centerlines in metres (origin bottom-left of the building, y up).
export const SAMPLE_WALLS = [
  [[0, 0], [14, 0], EXT], [[14, 0], [14, 10], EXT], [[14, 10], [0, 10], EXT], [[0, 10], [0, 0], EXT],
  [[6, 0], [6, 10], INT], [[6, 5], [14, 5], INT], [[0, 6], [6, 6], INT], [[10, 5], [10, 10], INT],
];
// [wall index, from, to (metres along the wall), kind]
export const SAMPLE_OPENINGS = [
  [0, 2.0, 3.0, 'Door'], [0, 4.0, 5.5, 'Window'], [0, 9.0, 11.0, 'Window'],
  [1, 1.5, 3.0, 'Window'], [1, 7.0, 8.2, 'Window'],
  [2, 4.5, 6.0, 'Window'], [2, 10.5, 12.0, 'Window'],
  [3, 1.5, 2.5, 'Window'], [3, 6.5, 8.0, 'Window'],
  [4, 3.5, 4.4, 'Door'], [4, 8.0, 8.9, 'Door'],
  [6, 3.5, 4.4, 'Door'],
  [7, 1.0, 1.8, 'Door'],
];

export function drawSamplePlan({ style = 'filled', ppm = 80 } = {}) {
  const margin = 1.6;
  const W = Math.round((14 + 2 * margin) * ppm), H = Math.round((10 + 2 * margin) * ppm);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const P = (x, y) => [(x + margin) * ppm, H - (y + margin) * ppm];
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.lineCap = 'butt';

  const walls = SAMPLE_WALLS.map(([a, b, t]) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { a, b, t, L, d: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] };
  });
  const at = (w, u, v = 0) => [w.a[0] + w.d[0] * u - w.d[1] * v, w.a[1] + w.d[1] * u + w.d[0] * v];

  // Wall pieces between openings (extended by half the thickness at both ends so corners close).
  const piecesOf = (i) => {
    const w = walls[i];
    const cuts = SAMPLE_OPENINGS.filter((o) => o[0] === i).map((o) => [o[1], o[2]]).sort((p, q) => p[0] - q[0]);
    const out = [];
    let s = -w.t / 2;
    for (const [u0, u1] of cuts) { out.push([s, u0]); s = u1; }
    out.push([s, w.L + w.t / 2]);
    return out;
  };
  const quad = (w, u0, u1) => [at(w, u0, w.t / 2), at(w, u1, w.t / 2), at(w, u1, -w.t / 2), at(w, u0, -w.t / 2)].map(([x, y]) => P(x, y));
  const path = (pts) => {
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };

  walls.forEach((w, i) => {
    for (const [u0, u1] of piecesOf(i)) {
      const q = quad(w, u0, u1);
      if (style === 'filled') {
        path(q);
        ctx.fillStyle = '#1f1f1f';
        ctx.fill();
      } else {
        // outlined: two wall lines, closed ends at openings, hatch for exterior walls
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(...q[0]); ctx.lineTo(...q[1]);
        ctx.moveTo(...q[3]); ctx.lineTo(...q[2]);
        ctx.moveTo(...q[0]); ctx.lineTo(...q[3]);
        ctx.moveTo(...q[1]); ctx.lineTo(...q[2]);
        ctx.stroke();
        if (w.t > 0.2) {
          ctx.save();
          path(q);
          ctx.clip();
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let k = -H; k < W + H; k += 9) { ctx.moveTo(k, 0); ctx.lineTo(k + H, H); }
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  });

  // Openings
  for (const [i, u0, u1, kind] of SAMPLE_OPENINGS) {
    const w = walls[i];
    ctx.strokeStyle = '#222';
    if (kind === 'Window') {
      ctx.lineWidth = 1.5;
      for (const v of [w.t / 2, w.t / 6, -w.t / 6, -w.t / 2]) {
        ctx.beginPath();
        ctx.moveTo(...P(...at(w, u0, v)));
        ctx.lineTo(...P(...at(w, u1, v)));
        ctx.stroke();
      }
      if (style === 'filled') {
        ctx.beginPath();
        ctx.moveTo(...P(...at(w, u0, w.t / 2))); ctx.lineTo(...P(...at(w, u0, -w.t / 2)));
        ctx.moveTo(...P(...at(w, u1, w.t / 2))); ctx.lineTo(...P(...at(w, u1, -w.t / 2)));
        ctx.stroke();
      }
    } else {
      const width = u1 - u0;
      const side = i === 0 ? 1 : -1;
      const hinge = at(w, u0, (side * w.t) / 2);
      const leaf = [hinge[0] - w.d[1] * side * width, hinge[1] + w.d[0] * side * width];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(...P(...hinge));
      ctx.lineTo(...P(...leaf));
      ctx.stroke();
      ctx.lineWidth = 1;
      const [hx, hy] = P(...hinge);
      const a0 = Math.atan2(P(...leaf)[1] - hy, P(...leaf)[0] - hx);
      const end = P(...at(w, u1, (side * w.t) / 2));
      const a1 = Math.atan2(end[1] - hy, end[0] - hx);
      ctx.beginPath();
      ctx.arc(hx, hy, width * ppm, a0, a1, side < 0 ? false : true);
      ctx.stroke();
    }
  }

  // Furniture (thin linework the detector must ignore)
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#555';
  const rect = (x, y, w, h) => { const [px, py] = P(x, y + h); ctx.strokeRect(px, py, w * ppm, h * ppm); };
  rect(10.6, 1.0, 1.9, 2.1); rect(10.6, 2.6, 1.9, 0.45); // bed + pillows
  rect(7.2, 6.2, 1.6, 2.0); // bed 2
  rect(0.8, 0.9, 2.4, 0.9); rect(0.8, 0.9, 0.3, 0.9); rect(2.9, 0.9, 0.3, 0.9); // sofa
  rect(2.2, 3.2, 1.6, 0.9); // table
  rect(0.3, 9.2, 5.4, 0.6); // kitchen counter
  rect(12.6, 8.6, 1.1, 1.1); // shower

  // Labels & dimensions
  ctx.fillStyle = '#222';
  ctx.font = `600 ${Math.round(ppm * 0.22)}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  const label = (t, x, y) => ctx.fillText(t, ...P(x, y));
  label('LIVING / DINING', 3, 2.6); label('KITCHEN', 3, 8); label('BEDROOM 1', 10, 4.2);
  label('BEDROOM 2', 8, 8.7); label('BATH', 12, 6.7);
  ctx.font = `${Math.round(ppm * 0.16)}px Arial, sans-serif`;
  label('6.00 x 6.00', 3, 2.25); label('8.00 x 5.00', 10, 3.85);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#333';
  const dim = (x0, y0, x1, y1, text) => {
    ctx.beginPath();
    ctx.moveTo(...P(x0, y0)); ctx.lineTo(...P(x1, y1));
    for (const [x, y] of [[x0, y0], [x1, y1]]) {
      const [px, py] = P(x, y);
      ctx.moveTo(px - 5, py + 5); ctx.lineTo(px + 5, py - 5);
    }
    ctx.stroke();
    const [mx, my] = P((x0 + x1) / 2, (y0 + y1) / 2);
    ctx.save();
    ctx.translate(mx, my - 6);
    if (x0 === x1) ctx.rotate(-Math.PI / 2);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };
  dim(-EXT / 2, -0.9, 14 + EXT / 2, -0.9, '14230');
  dim(-0.9, -EXT / 2, -0.9, 10 + EXT / 2, '10230');
  ctx.font = `600 ${Math.round(ppm * 0.26)}px Arial, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('GROUND FLOOR PLAN  1:100', ...P(0, 10.9));
  return { canvas, ppm, origin: P(0, 0) };
}
