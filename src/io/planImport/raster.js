// Loads PNG/JPG/WebP images and PDF pages into a working-resolution canvas for wall detection.

const MAX_SIDE = 2400;
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/';

function whiteCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  return { canvas, ctx };
}

export async function loadRasterFile(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return loadPdf(await file.arrayBuffer(), file.name);
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const { canvas, ctx } = whiteCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return { canvas, name: file.name, note: k < 1 ? `downscaled from ${bmp.width}×${bmp.height}` : '' };
}

export async function loadPdf(buffer, name = 'plan.pdf') {
  const pdfjs = await import(`${PDFJS}pdf.min.mjs`);
  // Run the PDF engine on the main thread: loading the worker module here registers
  // globalThis.pdfjsWorker, so pdf.js never needs a cross-origin Web Worker (which some browsers block).
  if (!globalThis.pdfjsWorker) await import(`${PDFJS}pdf.worker.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.mjs`;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(6, MAX_SIDE / Math.max(base.width, base.height)) });
  const { canvas, ctx } = whiteCanvas(Math.round(viewport.width), Math.round(viewport.height));
  // 'print' intent renders without requestAnimationFrame pacing, so it also completes in a background tab
  await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
  return { canvas, name, note: pdf.numPages > 1 ? `page 1 of ${pdf.numPages}` : '' };
}

export function grayscale(canvas) {
  const { width: w, height: h } = canvas;
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    // transparent pixels count as paper
    const a = data[j + 3] / 255;
    gray[i] = Math.round((0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]) * a + 255 * (1 - a));
  }
  return { gray, w, h };
}

/** Otsu's threshold, clamped to a sensible range for line drawings. */
export function otsu(gray) {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v] += 1;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; threshold = t; }
  }
  return Math.max(70, Math.min(215, threshold));
}
