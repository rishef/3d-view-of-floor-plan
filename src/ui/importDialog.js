import { h } from './dom.js';
import { openModal, field } from './modal.js';
import { loadRasterFile, grayscale, otsu } from '../io/planImport/raster.js';
import { detectRaster, dominantThickness, rasterGapClassifier } from '../io/planImport/detect.js';
import { parseDXF, guessUnits, dxfWallCandidates, dxfGapClassifier, DXF_UNITS } from '../io/planImport/dxf.js';
import { cleanupWalls, wallsBounds } from '../io/planImport/cleanup.js';
import { drawSamplePlan } from '../io/planImport/samplePlan.js';
import { applyImport } from '../io/planImport/buildModel.js';
import { promptDialog } from './dialogs.js';

const ACCEPT = '.png,.jpg,.jpeg,.webp,.bmp,.gif,.pdf,.dxf';

/**
 * Import Floor Plan wizard: load an image/PDF/DXF, set the scale, tune detection while watching the
 * overlay, then build a 3D model (or keep the drawing as a tracing underlay).
 */
export function openImportDialog(app) {
  const S = {
    source: null,
    ppm: null, scaleMethod: 'auto', typicalWall: 230, measure: null,
    threshold: 160, mode: 'auto',
    minThick: 75, maxThick: 450, minLen: 400,
    dxfUnits: 'auto', dxfLayers: null,
    det: null, result: null, shift: { x: 0, y: 0 }, info: '',
    build: { replace: true, levelId: app.activeLevelId, heightMode: 'next', height: 3000, floor: true, roof: true, rooms: true },
  };

  const modal = openModal({ title: 'Import Floor Plan → 3D', className: 'import-modal' });
  const canvas = h('canvas', { class: 'imp-canvas' });
  const hintEl = h('div', { class: 'imp-hint' }, 'Choose a floor plan image, PDF or DXF — or try the sample drawing.');
  const stage = h('div', { class: 'imp-stage' }, canvas, hintEl);
  const side = h('div', { class: 'imp-side' });
  const statusEl = h('div', { class: 'imp-status' });
  modal.body.append(stage, side);

  const fileInput = h('input', { type: 'file', accept: ACCEPT, hidden: true, onchange: () => fileInput.files?.[0] && loadFile(fileInput.files[0]) });
  const createBtn = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => create() }, 'Create 3D model');
  const traceBtn = h('button', { class: 'btn', type: 'button', disabled: true, onclick: () => traceOnly() }, 'Trace manually (underlay only)');
  modal.foot.append(
    fileInput,
    h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, 'Choose file…'),
    h('button', { class: 'btn', type: 'button', onclick: () => loadSample('filled') }, 'Sample: filled walls'),
    h('button', { class: 'btn', type: 'button', onclick: () => loadSample('outlined') }, 'Sample: outlined walls'),
    statusEl, traceBtn, createBtn);

  // drag & drop onto the preview
  stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('drop'); });
  stage.addEventListener('dragleave', () => stage.classList.remove('drop'));
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    stage.classList.remove('drop');
    const f = e.dataTransfer?.files?.[0];
    if (f) loadFile(f);
  });

  // ---- preview view transform ------------------------------------------------------
  const view = { scale: 1, ox: 0, oy: 0 };
  const flipY = () => S.source?.kind === 'dxf';
  const srcToScreen = (p) => ({ x: view.ox + p.x * view.scale, y: flipY() ? view.oy - p.y * view.scale : view.oy + p.y * view.scale });
  const screenToSrc = (x, y) => ({ x: (x - view.ox) / view.scale, y: flipY() ? (view.oy - y) / view.scale : (y - view.oy) / view.scale });

  const sourceBounds = () => {
    if (!S.source) return null;
    if (S.source.kind === 'raster') return { minX: 0, minY: 0, maxX: S.source.w, maxY: S.source.h };
    return S.source.bounds;
  };

  function fitPreview() {
    const r = stage.getBoundingClientRect();
    const b = sourceBounds();
    if (!b || !r.width) return;
    const bw = b.maxX - b.minX || 1, bh = b.maxY - b.minY || 1;
    view.scale = Math.min((r.width - 40) / bw, (r.height - 40) / bh);
    view.ox = r.width / 2 - ((b.minX + b.maxX) / 2) * view.scale;
    view.oy = flipY() ? r.height / 2 + ((b.minY + b.maxY) / 2) * view.scale : r.height / 2 - ((b.minY + b.maxY) / 2) * view.scale;
    draw();
  }

  // world (metres, shifted) -> source coordinates
  const worldToSrc = (p) => {
    const x = p.x + S.shift.x, y = p.y + S.shift.y;
    if (S.source.kind === 'raster') return { x: x * S.ppm, y: S.source.h - y * S.ppm };
    return { x: x / S.source.k, y: y / S.source.k };
  };

  function draw() {
    const r = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#eef0f3';
    ctx.fillRect(0, 0, r.width, r.height);
    if (!S.source) return;
    if (S.source.kind === 'raster') {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(S.source.canvas, view.ox, view.oy, S.source.w * view.scale, S.source.h * view.scale);
    } else {
      ctx.fillStyle = '#fff';
      const b = S.source.bounds, tl = srcToScreen({ x: b.minX, y: b.maxY }), br = srcToScreen({ x: b.maxX, y: b.minY });
      ctx.fillRect(tl.x - 10, tl.y - 10, br.x - tl.x + 20, br.y - tl.y + 20);
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const s of S.source.segments) {
        if (S.dxfLayers && !S.dxfLayers.has(s.layer)) continue;
        const a = srcToScreen(s.a), q = srcToScreen(s.b);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
    }
    if (S.result && S.ppm !== null) {
      for (const w of S.result.walls) {
        const a = srcToScreen(worldToSrc(w.a)), b = srcToScreen(worldToSrc(w.b));
        const px = (S.source.kind === 'raster' ? w.t * S.ppm : w.t / S.source.k) * view.scale;
        ctx.strokeStyle = 'rgba(10,108,255,0.55)';
        ctx.lineWidth = Math.max(2, px);
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (const o of S.result.openings) {
        const w = S.result.walls[o.wall];
        const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
        const d = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
        const p0 = { x: w.a.x + d.x * (o.u - o.width / 2), y: w.a.y + d.y * (o.u - o.width / 2) };
        const p1 = { x: w.a.x + d.x * (o.u + o.width / 2), y: w.a.y + d.y * (o.u + o.width / 2) };
        const a = srcToScreen(worldToSrc(p0)), b = srcToScreen(worldToSrc(p1));
        ctx.strokeStyle = o.kind === 'Door' ? '#f08c00' : '#12b886';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    if (S.measure?.length) {
      ctx.strokeStyle = '#e03131';
      ctx.fillStyle = '#e03131';
      ctx.lineWidth = 2;
      const pts = S.measure.map(srcToScreen);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (S.measureHover && pts.length === 1) { const q = srcToScreen(S.measureHover); ctx.lineTo(q.x, q.y); }
      ctx.stroke();
      for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  // pan / zoom / measure
  let drag = null;
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const before = screenToSrc(sx, sy);
    view.scale *= Math.exp(-e.deltaY * 0.0015);
    const after = srcToScreen(before);
    view.ox += sx - after.x;
    view.oy += sy - after.y;
    draw();
  }, { passive: false });
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (S.measure && e.button === 0) {
      S.measure.push(screenToSrc(sx, sy));
      if (S.measure.length === 2) finishMeasure();
      draw();
      return;
    }
    drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (S.measure) {
      const r = canvas.getBoundingClientRect();
      S.measureHover = screenToSrc(e.clientX - r.left, e.clientY - r.top);
      draw();
    }
    if (!drag) return;
    view.ox = drag.ox + e.clientX - drag.x;
    view.oy = drag.oy + e.clientY - drag.y;
    draw();
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('dblclick', () => fitPreview());
  new ResizeObserver(() => draw()).observe(stage);

  function startMeasure() {
    S.measure = [];
    canvas.style.cursor = 'crosshair';
    hintEl.textContent = 'Click the two ends of a dimension you know (e.g. the overall width).';
    hintEl.hidden = false;
    draw();
  }

  async function finishMeasure() {
    const [a, b] = S.measure;
    const px = Math.hypot(b.x - a.x, b.y - a.y);
    canvas.style.cursor = '';
    hintEl.hidden = true;
    const answer = await promptDialog('Real length between the two points', '5000', { title: 'Set drawing scale', ok: 'Set scale', type: 'number', suffix: 'mm' });
    const mmVal = parseFloat(answer);
    S.measure = null;
    if (!(mmVal > 0) || px < 2) { draw(); return; }
    S.ppm = px / (mmVal / 1000);
    S.scaleMethod = 'measured';
    renderSide();
    runDetection();
  }

  // ---- loading ----------------------------------------------------------------------------
  async function loadFile(file) {
    statusEl.textContent = `Reading ${file.name}…`;
    try {
      if (/\.dxf$/i.test(file.name)) {
        const parsed = parseDXF(await file.text());
        if (!parsed.segments.length) throw new Error('no LINE / POLYLINE geometry found');
        setDxfSource(parsed, file.name);
      } else if (/\.dwg$/i.test(file.name)) {
        throw new Error('DWG is a closed format — save it as DXF from your CAD tool and import that');
      } else {
        const r = await loadRasterFile(file);
        setRasterSource(r.canvas, file.name, r.note);
      }
    } catch (err) {
      statusEl.textContent = `Could not read ${file.name}: ${err.message}`;
    }
  }

  function loadSample(style) {
    const { canvas: c, ppm } = drawSamplePlan({ style });
    setRasterSource(c, `sample-${style}.png`, 'generated sample, 1:100');
    S.ppm = ppm;
    S.scaleMethod = 'measured';
    renderSide();
    runDetection();
  }

  function setRasterSource(c, name, note) {
    const { gray, w, h: ht } = grayscale(c);
    S.source = { kind: 'raster', canvas: c, gray, w, h: ht, name, note };
    S.threshold = otsu(gray);
    S.ppm = null;
    S.scaleMethod = 'auto';
    hintEl.hidden = true;
    fitPreview();
    renderSide();
    runDetection();
  }

  function setDxfSource(parsed, name) {
    const xs = parsed.segments.flatMap((s) => [s.a.x, s.b.x]), ys = parsed.segments.flatMap((s) => [s.a.y, s.b.y]);
    const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    S.source = { kind: 'dxf', ...parsed, bounds, name, note: `${parsed.segments.length} segments, ${parsed.layers.length} layers` };
    const wallish = parsed.layers.filter((l) => /wall|wand|mur/i.test(l));
    S.dxfLayers = new Set(wallish.length ? wallish : parsed.layers);
    S.dxfUnits = 'auto';
    hintEl.hidden = true;
    fitPreview();
    renderSide();
    runDetection();
  }

  // ---- detection -----------------------------------------------------------------------------
  let timer = 0;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(runDetection, 250); };

  function runDetection() {
    if (!S.source) return;
    const t0 = performance.now();
    try {
      if (S.source.kind === 'raster') detectRasterSource();
      else detectDxfSource();
      const r = S.result;
      const doors = r ? r.openings.filter((o) => o.kind === 'Door').length : 0;
      const wins = r ? r.openings.length - doors : 0;
      statusEl.textContent = r
        ? `${r.walls.length} walls · ${doors} doors · ${wins} windows${S.info ? ` · ${S.info}` : ''} · ${Math.round(performance.now() - t0)} ms`
        : S.info;
    } catch (err) {
      console.error(err);
      S.result = null;
      statusEl.textContent = `Detection failed: ${err.message}`;
    }
    createBtn.disabled = !S.result?.walls.length;
    traceBtn.disabled = !S.source || S.ppm === null;
    draw();
  }

  function detectRasterSource() {
    const { gray, w, h: ht } = S.source;
    if (S.scaleMethod === 'auto') {
      const probe = detectRaster(gray, w, ht, {
        threshold: S.threshold, mode: S.mode,
        minThickPx: Math.max(3, Math.min(w, ht) / 320), maxThickPx: Math.min(w, ht) / 25,
        minLenPx: Math.max(w, ht) / 40, minWinPx: Math.max(w, ht) / 60,
      });
      const tPx = dominantThickness(probe.walls);
      S.ppm = tPx ? tPx / (S.typicalWall / 1000) : null;
    }
    if (!S.ppm) {
      S.result = null;
      S.info = 'No walls found to estimate the scale — use “Measure” with a known dimension';
      return;
    }
    const ppm = S.ppm;
    const det = detectRaster(gray, w, ht, {
      threshold: S.threshold, mode: S.mode,
      minThickPx: (S.minThick / 1000) * ppm, maxThickPx: (S.maxThick / 1000) * ppm,
      minLenPx: (S.minLen / 1000) * ppm, minWinPx: 0.4 * ppm,
    });
    S.det = det;
    const toW = (p) => ({ x: p.x / ppm, y: (ht - p.y) / ppm });
    const toPx = (p) => ({ x: p.x * ppm, y: ht - p.y * ppm });
    const res = cleanupWalls(
      det.walls.map((x) => ({ a: toW(x.a), b: toW(x.b), t: x.t / ppm })),
      det.windows.map((x) => ({ center: toW(x.center), width: x.width / ppm, kind: 'Window' })),
      { minLen: S.minLen / 1000, classify: rasterGapClassifier(det.bin, w, ht, toPx, ppm) },
    );
    finishResult(res);
    S.info = `${det.mode} walls · 1 m = ${ppm.toFixed(1)} px${S.scaleMethod === 'auto' ? ' (estimated)' : ''}`;
  }

  function detectDxfSource() {
    const k = S.dxfUnits === 'auto' ? S.source.unitsToM ?? guessUnits(S.source.segments) : Number(S.dxfUnits);
    S.source.k = k;
    S.ppm = 1; // marks the scale as known
    const all = S.source.segments.map((s) => ({ a: { x: s.a.x * k, y: s.a.y * k }, b: { x: s.b.x * k, y: s.b.y * k }, layer: s.layer, arc: s.arc }));
    const segs = all.filter((s) => !S.dxfLayers || S.dxfLayers.has(s.layer));
    const cands = dxfWallCandidates(segs, { minThick: S.minThick / 1000, maxThick: S.maxThick / 1000, minLen: S.minLen / 1000 });
    // glazing usually lives on its own layer, so openings are classified against every layer
    const res = cleanupWalls(cands, [], { minLen: S.minLen / 1000, classify: dxfGapClassifier(all) });
    S.dxfSegsM = all;
    finishResult(res);
    S.info = `units: ${DXF_UNITS.find(([v]) => Number(v) === k)?.[1] ?? `${k} m`}`;
  }

  /** Moves the result so the building's lower-left corner sits at the project origin. */
  function finishResult(res) {
    const b = wallsBounds(res.walls);
    const sh = b.empty ? { x: 0, y: 0 } : { x: b.minX, y: b.minY };
    const mv = (p) => ({ x: p.x - sh.x, y: p.y - sh.y });
    S.shift = sh;
    S.result = { walls: res.walls.map((w) => ({ a: mv(w.a), b: mv(w.b), t: w.t })), openings: res.openings };
  }

  // ---- outputs ---------------------------------------------------------------------------------
  function underlay() {
    if (!S.source || S.ppm === null) return null;
    if (S.source.kind === 'raster') {
      return { kind: 'image', image: S.source.canvas, x: -S.shift.x, y: S.source.h / S.ppm - S.shift.y, w: S.source.w / S.ppm, h: S.source.h / S.ppm, opacity: 0.35, name: S.source.name };
    }
    return { kind: 'lines', segs: (S.dxfSegsM ?? []).map((s) => ({ a: { x: s.a.x - S.shift.x, y: s.a.y - S.shift.y }, b: { x: s.b.x - S.shift.x, y: s.b.y - S.shift.y } })), opacity: 0.5, name: S.source.name };
  }

  function create() {
    if (!S.result) return;
    const b = S.build;
    const ul = underlay();
    const summary = applyImport(app, S.result, {
      replace: b.replace, name: S.source.name.replace(/\.[^.]+$/, ''), levelId: b.levelId,
      heightMode: b.heightMode, height: b.height / 1000, floor: b.floor, roof: b.roof, rooms: b.rooms,
    });
    if (ul) app.setUnderlay(app.activeLevelId, ul);
    modal.close();
    app.status(`Imported ${summary.walls} walls, ${summary.doors} doors, ${summary.windows} windows, ${summary.rooms} rooms${summary.roof ? ' + floor & roof' : ''}. Check it against the faded drawing and fix anything with the normal tools.`);
  }

  function traceOnly() {
    const ul = underlay();
    if (!ul) return;
    app.setUnderlay(app.activeLevelId, ul);
    modal.close();
    app.setViewMode('plan');
    app.setTool('wall');
    requestAnimationFrame(() => app.planView.fit());
    app.status('Drawing placed as an underlay — trace the walls with the Wall tool (WA)');
  }

  // ---- settings panel --------------------------------------------------------------------------------
  function num(value, onChange, attrs = {}) {
    return h('input', { type: 'number', value, ...attrs, onchange: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v); } });
  }

  function renderSide() {
    const src = S.source;
    const blocks = [];
    blocks.push(h('section', {},
      h('h4', {}, '1 · Drawing'),
      src ? h('div', { class: 'imp-file' }, h('strong', {}, src.name), h('span', { class: 'muted' }, src.kind === 'raster' ? ` ${src.w}×${src.h}px ${src.note ?? ''}` : ` ${src.note}`))
        : h('p', { class: 'muted' }, 'PNG, JPG or PDF scans/exports, or DXF from CAD. Drag a file onto the preview.')));

    if (src?.kind === 'raster') {
      blocks.push(h('section', {},
        h('h4', {}, '2 · Scale'),
        h('div', { class: 'imp-scale' },
          h('strong', {}, S.ppm ? `1 m = ${S.ppm.toFixed(1)} px` : 'unknown'),
          h('span', { class: 'muted' }, S.scaleMethod === 'auto' ? ' estimated' : ' measured')),
        h('button', { class: 'btn small', type: 'button', onclick: startMeasure }, 'Measure a known dimension…'),
        field('Auto: typical wall', num(S.typicalWall, (v) => { S.typicalWall = v; S.scaleMethod = 'auto'; renderSide(); schedule(); }, { step: 10, min: 50 }), 'mm'),
      ));
      blocks.push(h('section', {},
        h('h4', {}, '3 · Detection'),
        field('Wall drawing', (() => {
          const sel = h('select', { onchange: (e) => { S.mode = e.target.value; schedule(); } },
            [['auto', 'Auto'], ['filled', 'Filled / solid'], ['outlined', 'Outlined / hatched']].map(([v, l]) => h('option', { value: v, selected: S.mode === v }, l)));
          return sel;
        })()),
        field(`Ink threshold (${S.threshold})`, h('input', { type: 'range', min: 40, max: 240, value: S.threshold, oninput: (e) => { S.threshold = +e.target.value; e.target.previousSibling.textContent = `Ink threshold (${S.threshold})`; schedule(); } })),
        field('Wall thickness min', num(S.minThick, (v) => { S.minThick = v; schedule(); }, { step: 10 }), 'mm'),
        field('Wall thickness max', num(S.maxThick, (v) => { S.maxThick = v; schedule(); }, { step: 10 }), 'mm'),
        field('Min wall length', num(S.minLen, (v) => { S.minLen = v; schedule(); }, { step: 50 }), 'mm'),
      ));
    } else if (src?.kind === 'dxf') {
      const layerList = h('div', { class: 'imp-layers' }, src.layers.map((l) => h('label', {},
        h('input', { type: 'checkbox', checked: S.dxfLayers.has(l), onchange: (e) => { if (e.target.checked) S.dxfLayers.add(l); else S.dxfLayers.delete(l); schedule(); } }),
        ` ${l} `, h('span', { class: 'muted' }, `(${src.segments.filter((s) => s.layer === l).length})`))));
      blocks.push(h('section', {},
        h('h4', {}, '2 · Units & layers'),
        field('Drawing units', h('select', { onchange: (e) => { S.dxfUnits = e.target.value; schedule(); } },
          DXF_UNITS.map(([v, l]) => h('option', { value: v, selected: S.dxfUnits === v }, v === 'auto' && src.unitsToM ? `Auto (file: ${DXF_UNITS.find(([x]) => Number(x) === src.unitsToM)?.[1] ?? src.unitsToM})` : l)))),
        h('div', { class: 'flabel' }, 'Layers holding walls'),
        layerList));
      blocks.push(h('section', {},
        h('h4', {}, '3 · Detection'),
        field('Wall thickness min', num(S.minThick, (v) => { S.minThick = v; schedule(); }, { step: 10 }), 'mm'),
        field('Wall thickness max', num(S.maxThick, (v) => { S.maxThick = v; schedule(); }, { step: 10 }), 'mm'),
        field('Min wall length', num(S.minLen, (v) => { S.minLen = v; schedule(); }, { step: 50 }), 'mm')));
    }

    if (src) {
      const b = S.build;
      blocks.push(h('section', {},
        h('h4', {}, '4 · Build'),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: b.replace, onchange: (e) => { b.replace = e.target.checked; renderSide(); } }), ' Start a new project (keeps site & nearby buildings)'),
        b.replace ? null : field('Place on level', h('select', { onchange: (e) => { b.levelId = e.target.value; } }, app.doc.levels().map((l) => h('option', { value: l.id, selected: l.id === b.levelId }, l.name)))),
        field('Wall height', h('select', { onchange: (e) => { b.heightMode = e.target.value; renderSide(); } },
          h('option', { value: 'next', selected: b.heightMode === 'next' }, 'Up to next level'),
          h('option', { value: 'fixed', selected: b.heightMode === 'fixed' }, 'Fixed height'))),
        b.heightMode === 'fixed' ? field('Height', num(b.height, (v) => { b.height = v; }, { step: 100, min: 500 }), 'mm') : null,
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: b.floor, onchange: (e) => { b.floor = e.target.checked; } }), ' Floor slab'),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: b.roof, onchange: (e) => { b.roof = e.target.checked; } }), ' Roof slab'),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: b.rooms, onchange: (e) => { b.rooms = e.target.checked; } }), ' Rooms in enclosed spaces'),
        h('p', { class: 'legend' }, h('span', { class: 'sw wall' }), 'wall ', h('span', { class: 'sw door' }), 'door ', h('span', { class: 'sw win' }), 'window'),
      ));
    }
    side.replaceChildren(...blocks);
  }

  renderSide();
  requestAnimationFrame(() => draw());
}
