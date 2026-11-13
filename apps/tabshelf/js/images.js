/**
 * images.js — Elaborazione delle immagini nel browser: lettura (con orientamento EXIF),
 * rotazione, ritaglio, ridimensionamento, compressione WebP e miniature.
 */
import { IMAGES } from './config.js';
import { h } from './util.js';
import { openDialog } from './ui.js';
import { firstPageCanvas } from './pdf.js';

/** Lato massimo usato durante la modifica (più del finale, per ritagliare senza perdere dettaglio). */
const EDIT_MAX_SIDE = 4400;

/* ================================================================ BASE */

export function makeCanvas(w, hgt) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(hgt));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Legge un'immagine e la disegna su un canvas (sfondo bianco, orientamento EXIF applicato). */
export async function blobToCanvas(blob, maxSide = EDIT_MAX_SIDE) {
  let src; let w; let hgt;
  try {
    src = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    w = src.width; hgt = src.height;
  } catch {
    src = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Immagine non leggibile o danneggiata.')); };
      img.src = url;
    });
    w = src.naturalWidth; hgt = src.naturalHeight;
  }
  const scale = Math.min(1, maxSide / Math.max(w, hgt));
  const c = makeCanvas(w * scale, hgt * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  if (src.close) src.close();
  return c;
}

/** Ridimensiona (solo riducendo) con dimezzamenti successivi per mantenere nitide le linee sottili. */
export function resizeCanvas(src, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height));
  if (scale >= 1) return src;
  const tw = Math.round(src.width * scale); const th = Math.round(src.height * scale);
  let cur = src; let w = src.width; let hgt = src.height;
  while (w / 2 > tw) {
    w = Math.round(w / 2); hgt = Math.round(hgt / 2);
    const c = makeCanvas(w, hgt);
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, w, hgt);
    cur = c;
  }
  const out = makeCanvas(tw, th);
  const ctx = out.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, tw, th);
  return out;
}

export function rotateCanvas(src, deg) {
  const c = makeCanvas(src.height, src.width);
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** Ritaglia con un rettangolo in proporzione (0..1). */
export function cropCanvas(src, r) {
  const sx = Math.round(r.x * src.width); const sy = Math.round(r.y * src.height);
  const sw = Math.max(1, Math.round(r.w * src.width)); const sh = Math.max(1, Math.round(r.h * src.height));
  const c = makeCanvas(sw, sh);
  c.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

let webpOk = null;
async function canWebP() {
  if (webpOk === null) {
    const b = await new Promise((r) => makeCanvas(2, 2).toBlob(r, 'image/webp', 0.8));
    webpOk = !!b && b.type === 'image/webp';
  }
  return webpOk;
}

/** Codifica in WebP (o JPEG se il browser non sa fare WebP). */
export async function encode(canvas, quality) {
  const type = (await canWebP()) ? 'image/webp' : 'image/jpeg';
  const blob = await new Promise((r) => canvas.toBlob(r, type, quality));
  if (!blob) throw new Error('Impossibile comprimere l\'immagine (memoria insufficiente?).');
  return blob;
}

export function extFor(type) {
  return { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' }[type] || 'bin';
}

/* ================================================================ PREPARAZIONE PER L'INVIO */

/**
 * Prepara un'immagine: lato lungo max 2200 px, WebP qualità ~0,85.
 * Il risultato SOSTITUISCE l'originale; se però è più grande dell'originale
 * (e l'immagine non è stata modificata) si tiene l'originale.
 * editedCanvas: canvas già ruotato/ritagliato dall'utente (facoltativo).
 * Restituisce { file: Blob, thumb: Blob }.
 */
export async function prepareImage(original, editedCanvas = null) {
  const source = editedCanvas || await blobToCanvas(original, EDIT_MAX_SIDE);
  const full = resizeCanvas(source, IMAGES.maxSide);
  let file = await encode(full, IMAGES.quality);
  if (!editedCanvas && file.size >= original.size && ['image/jpeg', 'image/png'].includes(original.type)) {
    file = original;
  }
  const thumb = await encode(resizeCanvas(full, IMAGES.thumbSide), IMAGES.thumbQuality);
  return { file, thumb };
}

/** Miniatura della prima pagina di un PDF. */
export async function pdfThumb(blob) {
  const page = await firstPageCanvas(blob, IMAGES.thumbSide * 2);
  return encode(resizeCanvas(page, IMAGES.thumbSide), IMAGES.thumbQuality);
}

/** Anteprima piccola (canvas) di un file immagine o PDF, per la coda di caricamento. */
export async function previewCanvas(blob, isPdf, side = 320) {
  if (isPdf) return resizeCanvas(await firstPageCanvas(blob, side * 2), side);
  return resizeCanvas(await blobToCanvas(blob, side * 4), side);
}

/* ================================================================ EDITOR (ruota e ritaglia) */

/**
 * Apre l'editor su un'immagine. Restituisce il canvas modificato (già ridotto a 2200 px)
 * oppure null se l'utente annulla o non cambia nulla.
 * source: Blob dell'immagine oppure canvas.
 */
export async function editImage(source, title = 'Ruota e ritaglia') {
  const original = source instanceof HTMLCanvasElement ? source : await blobToCanvas(source, EDIT_MAX_SIDE);
  let work = original;
  let changed = false;
  let cropMode = false;
  let rect = null;

  const body = h(`<div class="editor">
    <div class="editor-stage"><canvas class="editor-canvas"></canvas><div class="crop-box" hidden></div></div>
    <div class="editor-tools" role="toolbar" aria-label="Strumenti">
      <button type="button" class="btn" data-act="left" title="Ruota a sinistra di 90°">⟲ Ruota a sinistra</button>
      <button type="button" class="btn" data-act="right" title="Ruota a destra di 90°">⟳ Ruota a destra</button>
      <button type="button" class="btn" data-act="crop">✂ Ritaglia</button>
      <button type="button" class="btn primary" data-act="cropok" hidden>Applica ritaglio</button>
      <button type="button" class="btn" data-act="cropno" hidden>Annulla ritaglio</button>
      <button type="button" class="btn ghost" data-act="reset">↺ Ripristina</button>
    </div>
    <p class="muted small editor-info"></p>
  </div>`);
  const canvas = body.querySelector('canvas');
  const box = body.querySelector('.crop-box');
  const info = body.querySelector('.editor-info');

  const draw = () => {
    const maxW = 1200;
    const s = Math.min(1, maxW / Math.max(work.width, work.height));
    canvas.width = Math.round(work.width * s); canvas.height = Math.round(work.height * s);
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(work, 0, 0, canvas.width, canvas.height);
    const f = Math.min(1, IMAGES.maxSide / Math.max(work.width, work.height));
    info.textContent = cropMode ? 'Trascina sull\'immagine per scegliere la parte da tenere, poi «Applica ritaglio».'
      : `Dimensioni finali: ${Math.round(work.width * f)} × ${Math.round(work.height * f)} px`;
  };
  const setCrop = (on) => {
    cropMode = on; rect = null; box.hidden = true;
    body.classList.toggle('cropping', on);
    body.querySelector('[data-act=crop]').hidden = on;
    body.querySelector('[data-act=cropok]').hidden = !on;
    body.querySelector('[data-act=cropno]').hidden = !on;
    draw();
  };
  body.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = () => {
      const a = b.dataset.act;
      if (a === 'left' || a === 'right') { work = rotateCanvas(work, a === 'right' ? 90 : -90); changed = true; setCrop(false); }
      if (a === 'crop') setCrop(true);
      if (a === 'cropno') setCrop(false);
      if (a === 'cropok') {
        if (rect && rect.w > 0.02 && rect.h > 0.02) { work = cropCanvas(work, rect); changed = true; }
        setCrop(false);
      }
      if (a === 'reset') { work = original; changed = false; setCrop(false); }
    };
  });

  // Selezione del ritaglio con mouse, penna o dito
  let start = null;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)), r };
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!cropMode) return;
    e.preventDefault(); canvas.setPointerCapture(e.pointerId); start = pos(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!cropMode || !start) return;
    const p = pos(e);
    const x = Math.min(start.x, p.x); const y = Math.min(start.y, p.y);
    const w = Math.abs(p.x - start.x); const hh = Math.abs(p.y - start.y);
    rect = { x: x / p.r.width, y: y / p.r.height, w: w / p.r.width, h: hh / p.r.height };
    Object.assign(box.style, { left: `${canvas.offsetLeft + x}px`, top: `${canvas.offsetTop + y}px`, width: `${w}px`, height: `${hh}px` });
    box.hidden = false;
  });
  const end = () => { start = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const d = openDialog({
    title, size: 'lg', body,
    actions: [
      { label: 'Annulla', value: false },
      { label: 'Usa questa versione', kind: 'primary', value: true },
    ],
  });
  draw();
  const ok = await d.result;
  if (!ok || !changed) return null;
  return resizeCanvas(work, IMAGES.maxSide);
}
