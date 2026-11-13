/**
 * pdf.js — Caricamento di PDF.js (solo quando serve) e utilità per i PDF.
 */
import { LIBS } from './config.js';

let libPromise = null;
export function loadPdfjs() {
  if (!libPromise) {
    libPromise = import(LIBS.pdfjs).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
      return lib;
    }).catch(() => { libPromise = null; throw new Error('Impossibile caricare il lettore PDF: controlla la connessione.'); });
  }
  return libPromise;
}

/** Apre un PDF da Blob/ArrayBuffer. Ricorda di chiamare closePdf() alla fine. */
export async function openPdf(data) {
  const lib = await loadPdfjs();
  // copia: PDF.js "consuma" il buffer che riceve, e quello originale può servire ancora
  const buf = data instanceof Blob ? await data.arrayBuffer() : data.slice(0);
  return lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
}

/** Disegna una pagina su un canvas con il lato lungo indicato. */
export async function renderPage(pdf, pageNumber, longSide) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = longSide / Math.max(base.width, base.height);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
  page.cleanup();
  return canvas;
}

/** Canvas della prima pagina (per la miniatura). */
export async function firstPageCanvas(blob, longSide) {
  const pdf = await openPdf(blob);
  try { return await renderPage(pdf, 1, longSide); } finally { closePdf(pdf); }
}

/** Libera la memoria di un PDF aperto. */
export function closePdf(pdf) {
  try {
    if (pdf?.loadingTask?.destroy) pdf.loadingTask.destroy();
    else if (pdf?.destroy) pdf.destroy();
  } catch { /* niente */ }
}
