/**
 * images.js — Decodifica, ridimensionamento, compressione e semplice editor
 * (rotazione, ritaglio, luminosità/contrasto, ripristino).
 */
import { IMAGE_MAX_SIDE, THUMB_MAX_SIDE, IMAGE_QUALITY, THUMB_QUALITY, KEEP_AS_IS_MAX_BYTES, UserError, html } from './utils.js';

/** Lato massimo della copia di lavoro nell'editor (consente ritagli senza perdere dettaglio). */
const WORK_MAX_SIDE = 3600;

/* ------------------------------------------------------------ decodifica */

/**
 * Decodifica un Blob immagine applicando l'orientamento EXIF.
 * Restituisce un canvas (sfondo bianco) limitato a maxSide.
 */
export async function blobToCanvas(blob, maxSide = WORK_MAX_SIDE) {
  let source; let w; let h;
  try {
    source = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    w = source.width; h = source.height;
  } catch {
    // Fallback: elemento <img> (i browser moderni applicano comunque l'EXIF)
    source = await loadImageElement(blob);
    w = source.naturalWidth; h = source.naturalHeight;
  }
  if (!w || !h) throw new UserError('Immagine non leggibile o danneggiata.');
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = makeCanvas(Math.round(w * scale), Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (source.close) source.close();
  return { canvas, naturalWidth: w, naturalHeight: h };
}

function loadImageElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new UserError('Formato immagine non supportato da questo browser o file danneggiato.')); };
    img.src = url;
  });
}

/** Crea un canvas con sfondo bianco (necessario per PNG trasparenti → JPEG). */
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Ridimensiona un canvas (riduzione progressiva per mantenere nitidezza). */
export function resizeCanvas(src, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height));
  if (scale >= 1) return src;
  let cur = src;
  let w = src.width; let h = src.height;
  const tw = Math.round(src.width * scale); const th = Math.round(src.height * scale);
  // Dimezzamenti successivi: evitano l'effetto "seghettato" su linee sottili.
  while (w / 2 > tw) {
    w = Math.round(w / 2); h = Math.round(h / 2);
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, w, h);
    cur = c;
  }
  const out = makeCanvas(tw, th);
  const ctx = out.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, tw, th);
  return out;
}

let webpSupport = null;
/** Verifica se il browser sa codificare WebP (Safari ad esempio no). */
async function canEncodeWebP() {
  if (webpSupport !== null) return webpSupport;
  const c = makeCanvas(2, 2);
  const b = await new Promise((r) => c.toBlob(r, 'image/webp', 0.9));
  webpSupport = !!b && b.type === 'image/webp';
  return webpSupport;
}

/** Codifica un canvas in WebP (preferito) o JPEG ad alta qualità. */
export async function encodeCanvas(canvas, quality = IMAGE_QUALITY, preferType = null) {
  const type = preferType || ((await canEncodeWebP()) ? 'image/webp' : 'image/jpeg');
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) throw new UserError('Impossibile codificare l\'immagine (memoria insufficiente?).');
  return blob;
}

/** Converte un blob qualsiasi in JPEG (usato dal generatore PDF). */
export async function blobToJpeg(blob, quality = 0.92) {
  const { canvas } = await blobToCanvas(blob, 10000);
  return encodeCanvas(canvas, quality, 'image/jpeg');
}

/**
 * Prepara le immagini da salvare a partire da un canvas di lavoro.
 * Se l'immagine originale è già adatta (PNG/WebP non modificata, non troppo grande)
 * viene conservata così com'è per la massima qualità.
 * maxSide: lato massimo (default 2400; più alto per le pagine PDF unite).
 */
export async function buildImages(canvas, { originalBlob = null, edited = false, maxSide = IMAGE_MAX_SIDE } = {}) {
  let fullBlob; let full;
  const longSide = Math.max(canvas.width, canvas.height);
  const keepAsIs = originalBlob && !edited && ['image/png', 'image/webp'].includes(originalBlob.type)
    && originalBlob.size <= KEEP_AS_IS_MAX_BYTES && longSide <= maxSide;
  if (keepAsIs) {
    fullBlob = originalBlob; full = canvas;
  } else {
    full = resizeCanvas(canvas, maxSide);
    fullBlob = await encodeCanvas(full, IMAGE_QUALITY);
  }
  const thumbCanvas = resizeCanvas(full, THUMB_MAX_SIDE);
  const thumbBlob = await encodeCanvas(thumbCanvas, THUMB_QUALITY);
  return {
    full: { blob: fullBlob, width: full.width, height: full.height },
    thumb: { blob: thumbBlob, width: thumbCanvas.width, height: thumbCanvas.height },
  };
}

/** Verifica che un file sia un'immagine supportata. */
export function isImageFile(file) {
  return file && (file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(file.name || ''));
}
export function isPdfFile(file) {
  return file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));
}

/* =================================================================== EDITOR */

/**
 * Editor non distruttivo: tiene una copia dell'originale per "Ripristina".
 * Uso: const ed = new ImageEditor(container); await ed.load(blob); ... const {canvas, edited} = ed.result();
 */
export class ImageEditor {
  constructor(container) {
    this.container = container;
    this.original = null;   // canvas originale
    this.work = null;       // canvas corrente (dopo rotazioni/ritagli)
    this.brightness = 0;    // -50..+50 (%)
    this.contrast = 0;      // -50..+50 (%)
    this.edited = false;
    this.cropMode = false;
    this.cropRect = null;
    this.maxSide = IMAGE_MAX_SIDE;
    this.render();
  }

  render() {
    this.container.innerHTML = '';
    this.el = html(`<div class="editor">
      <div class="editor-stage"><canvas class="editor-canvas" aria-label="Anteprima immagine"></canvas><div class="crop-box" hidden></div></div>
      <div class="editor-tools" role="toolbar" aria-label="Strumenti immagine">
        <button type="button" class="btn sm" data-act="rotl" title="Ruota a sinistra">⟲ Ruota</button>
        <button type="button" class="btn sm" data-act="rotr" title="Ruota a destra">⟳ Ruota</button>
        <button type="button" class="btn sm" data-act="crop" title="Ritaglia">✂ Ritaglia</button>
        <button type="button" class="btn sm primary" data-act="cropok" hidden>Applica ritaglio</button>
        <button type="button" class="btn sm" data-act="cropno" hidden>Annulla ritaglio</button>
        <label class="slider">Luminosità <input type="range" min="-50" max="50" value="0" data-adj="brightness"></label>
        <label class="slider">Contrasto <input type="range" min="-50" max="50" value="0" data-adj="contrast"></label>
        <button type="button" class="btn sm" data-act="reset" title="Ripristina l'immagine originale">↺ Ripristina</button>
      </div>
      <p class="editor-info muted small"></p>
    </div>`);
    this.container.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas');
    this.cropBox = this.el.querySelector('.crop-box');
    this.el.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => this.action(b.dataset.act); });
    this.el.querySelectorAll('[data-adj]').forEach((r) => {
      r.oninput = () => { this[r.dataset.adj] = +r.value; this.edited = true; this.applyPreviewFilter(); };
    });
    this.bindCrop();
  }

  async load(blob, maxSide = IMAGE_MAX_SIDE) {
    this.maxSide = maxSide;
    const { canvas } = await blobToCanvas(blob, Math.max(WORK_MAX_SIDE, maxSide));
    this.loadCanvas(canvas);
  }

  loadCanvas(canvas) {
    this.original = canvas;
    this.work = cloneCanvas(canvas);
    this.brightness = 0; this.contrast = 0; this.edited = false;
    this.el.querySelectorAll('[data-adj]').forEach((r) => { r.value = 0; });
    this.draw();
  }

  /** Disegna l'anteprima ridotta. */
  draw() {
    if (!this.work) return;
    const maxW = 1400;
    const scale = Math.min(1, maxW / Math.max(this.work.width, this.work.height));
    this.canvas.width = Math.round(this.work.width * scale);
    this.canvas.height = Math.round(this.work.height * scale);
    const ctx = this.canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.work, 0, 0, this.canvas.width, this.canvas.height);
    this.applyPreviewFilter();
    const longSide = Math.max(this.work.width, this.work.height);
    const finalScale = Math.min(1, (this.maxSide || IMAGE_MAX_SIDE) / longSide);
    this.el.querySelector('.editor-info').textContent =
      `Dimensioni finali: ${Math.round(this.work.width * finalScale)} × ${Math.round(this.work.height * finalScale)} px`;
  }

  applyPreviewFilter() {
    this.canvas.style.filter = (this.brightness || this.contrast)
      ? `brightness(${1 + this.brightness / 100}) contrast(${1 + this.contrast / 100})` : '';
  }

  action(act) {
    if (!this.work) return;
    if (act === 'rotl' || act === 'rotr') {
      this.work = rotateCanvas(this.work, act === 'rotr' ? 90 : -90);
      this.edited = true; this.endCrop(); this.draw();
    } else if (act === 'crop') {
      this.startCrop();
    } else if (act === 'cropok') {
      this.applyCrop();
    } else if (act === 'cropno') {
      this.endCrop();
    } else if (act === 'reset') {
      this.endCrop();
      this.loadCanvas(this.original);
    }
  }

  startCrop() {
    this.cropMode = true;
    this.cropRect = null;
    this.el.classList.add('cropping');
    this.el.querySelector('[data-act=cropok]').hidden = false;
    this.el.querySelector('[data-act=cropno]').hidden = false;
    this.el.querySelector('[data-act=crop]').hidden = true;
    this.el.querySelector('.editor-info').textContent = 'Trascina sull\'immagine per selezionare l\'area da mantenere.';
  }

  endCrop() {
    this.cropMode = false; this.cropRect = null;
    this.cropBox.hidden = true;
    this.el.classList.remove('cropping');
    this.el.querySelector('[data-act=cropok]').hidden = true;
    this.el.querySelector('[data-act=cropno]').hidden = true;
    this.el.querySelector('[data-act=crop]').hidden = false;
  }

  bindCrop() {
    let start = null;
    const stage = this.el.querySelector('.editor-stage');
    const pos = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)), r };
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.cropMode) return;
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      start = pos(e);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.cropMode || !start) return;
      const p = pos(e);
      const x = Math.min(start.x, p.x); const y = Math.min(start.y, p.y);
      const w = Math.abs(p.x - start.x); const h = Math.abs(p.y - start.y);
      this.cropRect = { x: x / p.r.width, y: y / p.r.height, w: w / p.r.width, h: h / p.r.height };
      const offX = this.canvas.offsetLeft; const offY = this.canvas.offsetTop;
      Object.assign(this.cropBox.style, { left: `${offX + x}px`, top: `${offY + y}px`, width: `${w}px`, height: `${h}px` });
      this.cropBox.hidden = false;
    });
    const end = () => { start = null; };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    stage.addEventListener('touchmove', (e) => { if (this.cropMode) e.preventDefault(); }, { passive: false });
  }

  applyCrop() {
    const r = this.cropRect;
    if (!r || r.w < 0.02 || r.h < 0.02) { this.endCrop(); return; }
    const sx = Math.round(r.x * this.work.width); const sy = Math.round(r.y * this.work.height);
    const sw = Math.max(1, Math.round(r.w * this.work.width)); const sh = Math.max(1, Math.round(r.h * this.work.height));
    const c = makeCanvas(sw, sh);
    c.getContext('2d').drawImage(this.work, sx, sy, sw, sh, 0, 0, sw, sh);
    this.work = c; this.edited = true;
    this.endCrop(); this.draw();
  }

  /** Restituisce il canvas finale (con luminosità/contrasto applicati ai pixel). */
  result() {
    if (!this.work) throw new UserError('Nessuna immagine caricata.');
    let out = this.work;
    if (this.brightness || this.contrast) {
      out = cloneCanvas(this.work);
      applyBrightnessContrast(out, this.brightness, this.contrast);
    }
    return { canvas: out, edited: this.edited };
  }
}

function cloneCanvas(src) {
  const c = makeCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

/** Ruota di ±90°. */
export function rotateCanvas(src, deg) {
  const c = makeCanvas(src.height, src.width);
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** Luminosità/contrasto sui pixel, stessa formula dei filtri CSS (compatibile Safari). */
function applyBrightnessContrast(canvas, brightness, contrast) {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const b = 1 + brightness / 100; const c = 1 + contrast / 100;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = ((i * b) - 128) * c + 128;
  for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
  ctx.putImageData(img, 0, 0);
}
