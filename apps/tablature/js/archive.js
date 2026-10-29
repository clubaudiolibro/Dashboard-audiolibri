/**
 * pdfimport.js — Importazione di PDF tramite PDF.js (caricato solo quando serve).
 * L'utente sceglie le pagine e la modalità (una tablatura per pagina oppure
 * pagine unite in un'unica immagine). Restituisce un elenco di immagini pronte
 * per il form di inserimento.
 *
 * Versione per la dashboard: PDF.js viene caricato da jsDelivr con versione bloccata.
 * Gli URL devono coincidere con quelli in CDN_ASSETS di service-worker.js,
 * che li salva in cache per il funzionamento offline.
 */
import { openModal, toast, progress } from './ui.js';
import { html, esc, UserError, IMAGE_MAX_SIDE } from './utils.js';
import { makeCanvas, encodeCanvas } from './images.js';

const PDFJS_VERSION = '5.4.296';
const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

let pdfjsPromise = null;

/** Carica PDF.js (in cache offline tramite service worker dopo il primo utilizzo online). */
async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_URL).then((lib) => {
      // Worker su un altro dominio: PDF.js lo avvia automaticamente tramite un wrapper interno.
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return lib;
    }).catch((e) => {
      pdfjsPromise = null;
      throw new UserError(
        (navigator.onLine
          ? 'Impossibile caricare il lettore PDF (browser troppo vecchio o rete bloccata?).'
          : 'Lettore PDF non ancora disponibile offline: apri l\'importazione PDF almeno una volta con la connessione attiva.')
        + ' Puoi comunque importare immagini e screenshot. Dettaglio: ' + e.message);
    });
  }
  return pdfjsPromise;
}

/** Limite di area del canvas per compatibilità con iOS/Safari. */
const MAX_CANVAS_AREA = 16_000_000;

async function renderPage(pdf, pageNo, targetLongSide) {
  const page = await pdf.getPage(pageNo);
  const vp1 = page.getViewport({ scale: 1 });
  const scale = targetLongSide / Math.max(vp1.width, vp1.height);
  const vp = page.getViewport({ scale });
  const canvas = makeCanvas(Math.round(vp.width), Math.round(vp.height));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, background: 'rgb(255,255,255)' }).promise;
  page.cleanup();
  return canvas;
}

/** Unisce più canvas in verticale rispettando il limite di area. */
function stackCanvases(canvases) {
  const width = Math.max(...canvases.map((c) => c.width));
  const height = canvases.reduce((s, c) => s + Math.round(c.height * (width / c.width)), 0);
  let scale = 1;
  if (width * height > MAX_CANVAS_AREA) scale = Math.sqrt(MAX_CANVAS_AREA / (width * height));
  const out = makeCanvas(Math.round(width * scale), Math.round(height * scale));
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  let y = 0;
  for (const c of canvases) {
    const h = Math.round(c.height * (width / c.width) * scale);
    ctx.drawImage(c, 0, y, out.width, h);
    y += h;
  }
  return out;
}

/**
 * Apre il dialogo di importazione PDF.
 * Restituisce Promise<{ items: [{ blob, name, maxSide? }], keepOriginal } | null>.
 */
export async function openPdfImport(file, { keepOriginalDefault = false } = {}) {
  const lib = await loadPdfJs();
  let pdf;
  const prog = progress('Lettura del PDF…');
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    pdf = await lib.getDocument({ data, isEvalSupported: false }).promise;
  } catch (e) {
    prog.close();
    throw new UserError(e && e.name === 'PasswordException' ? 'PDF protetto da password: non supportato.' : 'PDF non valido o danneggiato.');
  }
  prog.close();
  const n = pdf.numPages;
  return new Promise((resolve) => {
    const body = html(`<div class="pdf-import">
      <p class="muted small">${esc(file.name)} — ${n} pagin${n === 1 ? 'a' : 'e'}. Seleziona le pagine da importare.</p>
      <div class="btn-row wrap">
        <button type="button" class="btn sm" data-a="all">Seleziona tutte</button>
        <button type="button" class="btn sm" data-a="none">Deseleziona tutte</button>
      </div>
      <div class="pdf-pages"></div>
      <fieldset class="field"><legend>Modalità</legend>
        <label class="check"><input type="radio" name="mode" value="separate" checked> Una tablatura per ogni pagina</label>
        <label class="check"><input type="radio" name="mode" value="merge"> Unisci le pagine selezionate in un'unica tablatura</label>
      </fieldset>
      <label class="check"><input type="checkbox" name="keep" ${keepOriginalDefault ? 'checked' : ''}> Conserva anche il PDF originale (occupa spazio aggiuntivo)</label>
    </div>`);
    const footer = html(`<div class="btn-row"><button type="button" class="btn" data-a="c">Annulla</button><button type="button" class="btn primary" data-a="ok">Continua</button></div>`);
    const m = openModal({ title: 'Importa PDF', size: 'lg', body, footer, onClose: (r) => { pdf.destroy?.(); resolve(r || null); } });
    const grid = body.querySelector('.pdf-pages');
    // Anteprime caricate progressivamente
    for (let i = 1; i <= n; i++) {
      grid.appendChild(html(`<label class="pdf-page"><input type="checkbox" value="${i}" ${n <= 20 ? 'checked' : ''}>
        <span class="pdf-thumb" data-p="${i}"><span class="muted small">…</span></span><span class="small">Pagina ${i}</span></label>`));
    }
    const io = new IntersectionObserver(async (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        try {
          const c = await renderPage(pdf, +en.target.dataset.p, 260);
          en.target.innerHTML = ''; c.className = 'pdf-thumb-canvas'; en.target.appendChild(c);
        } catch { en.target.innerHTML = '<span class="small">Anteprima non disponibile</span>'; }
      }
    }, { root: m.body, rootMargin: '200px' });
    grid.querySelectorAll('.pdf-thumb').forEach((t) => io.observe(t));
    body.querySelector('[data-a=all]').onclick = () => grid.querySelectorAll('input').forEach((x) => { x.checked = true; });
    body.querySelector('[data-a=none]').onclick = () => grid.querySelectorAll('input').forEach((x) => { x.checked = false; });
    footer.querySelector('[data-a=c]').onclick = () => { io.disconnect(); m.close(null); };
    footer.querySelector('[data-a=ok]').onclick = async () => {
      const pages = [...grid.querySelectorAll('input:checked')].map((x) => +x.value);
      if (!pages.length) { toast('Seleziona almeno una pagina.', { type: 'warn' }); return; }
      const mode = body.querySelector('input[name=mode]:checked').value;
      const keepOriginal = body.querySelector('input[name=keep]').checked;
      const p = progress('Conversione delle pagine…');
      try {
        const items = [];
        const base = file.name.replace(/\.pdf$/i, '');
        if (mode === 'separate') {
          for (let k = 0; k < pages.length; k++) {
            p.update(`Pagina ${pages[k]} (${k + 1} di ${pages.length})`, k / pages.length);
            const c = await renderPage(pdf, pages[k], IMAGE_MAX_SIDE);
            items.push({ blob: await encodeCanvas(c, 0.95), name: `${base} - p${pages[k]}` });
          }
        } else {
          const canvases = [];
          const side = pages.length > 3 ? 1600 : 2000;
          for (let k = 0; k < pages.length; k++) {
            p.update(`Pagina ${pages[k]} (${k + 1} di ${pages.length})`, k / pages.length);
            canvases.push(await renderPage(pdf, pages[k], side));
          }
          const merged = stackCanvases(canvases);
          items.push({ blob: await encodeCanvas(merged, 0.95), name: `${base} - p${pages.join(',')}`, maxSide: 6000 });
        }
        p.close();
        io.disconnect();
        m.close({ items, keepOriginal });
      } catch (e) {
        p.close();
        toast('Errore nella conversione del PDF: ' + (e.userMessage || e.message), { type: 'error' });
      }
    };
  });
}
