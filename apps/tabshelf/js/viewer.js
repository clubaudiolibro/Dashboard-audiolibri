/**
 * viewer.js — Visualizzazione a schermo intero di una sequenza di documenti.
 *
 *  - swipe a sinistra/destra per cambiare documento (con precaricamento di prec. e succ.);
 *  - zoom con pizzico, trascinamento, doppio tocco; rotellina (+Ctrl per lo zoom) sul PC;
 *  - un tocco semplice nasconde o mostra l'interfaccia;
 *  - PDF resi con PDF.js, pagine in verticale, stessi gesti;
 *  - schermo sempre acceso (Screen Wake Lock) finché il documento è aperto;
 *  - barra inferiore: titolo e artista, stato (tocco per cambiare), voto a 5 stelle, chiudi.
 *    Le modifiche si salvano subito.
 */
import { STATUSES } from './config.js';
import { state } from './store.js';
import { updateDocument } from './actions.js';
import { signedUrl, refreshSignedUrl, fileArrayBuffer } from './storage.js';
import { esc, h } from './util.js';
import { toastError } from './ui.js';
import { openPdf, closePdf } from './pdf.js';
import { docTitle } from './filter.js';

const MAX_SCALE = 6;
const PDF_MAX_WIDTH = 1100;     // larghezza massima della colonna di pagine (schermi larghi)
const PDF_RENDER_MAX = 2400;    // larghezza massima in pixel di una pagina disegnata
const PAGE_GAP = 12;

let current = null; // viewer aperto

/* ================================================================ ZOOM E TRASCINAMENTO */

class Zoomer {
  constructor(stage, content, onChange) {
    this.stage = stage; this.content = content; this.onChange = onChange || (() => {});
    this.s = 1; this.x = 0; this.y = 0; this.bw = 1; this.bh = 1; this.topAlign = false;
    this.anim = null;
  }
  get vw() { return this.stage.clientWidth; }
  get vh() { return this.stage.clientHeight; }
  /** Dimensioni del contenuto a scala 1. */
  setBase(bw, bh, topAlign = false) { this.bw = bw; this.bh = bh; this.topAlign = topAlign; this.reset(); }
  reset() {
    this.stop(); this.s = 1;
    this.x = (this.vw - this.bw) / 2;
    this.y = this.topAlign && this.bh > this.vh ? 0 : (this.vh - this.bh) / 2;
    this.apply();
  }
  canPanX() { return this.bw * this.s > this.vw + 1; }
  canPanY() { return this.bh * this.s > this.vh + 1; }
  clamp() {
    const W = this.bw * this.s; const H = this.bh * this.s;
    this.x = W <= this.vw ? (this.vw - W) / 2 : Math.min(0, Math.max(this.vw - W, this.x));
    this.y = H <= this.vh ? (this.vh - H) / 2 : Math.min(0, Math.max(this.vh - H, this.y));
  }
  apply() {
    this.clamp();
    this.content.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.s})`;
    this.onChange(this);
  }
  zoomAt(px, py, ns) {
    ns = Math.max(1, Math.min(MAX_SCALE, ns));
    this.x = px - (px - this.x) * (ns / this.s);
    this.y = py - (py - this.y) * (ns / this.s);
    this.s = ns;
    this.apply();
  }
  panBy(dx, dy) { this.x += dx; this.y += dy; this.apply(); }
  /** Animazione verso una scala attorno a un punto. */
  animateZoom(px, py, target) {
    this.stop();
    const from = this.s; const t0 = performance.now(); const dur = 220;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur); const e = 1 - (1 - k) ** 3;
      this.zoomAt(px, py, from + (target - from) * e);
      if (k < 1) this.anim = requestAnimationFrame(step); else this.anim = null;
    };
    this.anim = requestAnimationFrame(step);
  }
  /** Scorrimento per inerzia dopo il trascinamento. */
  fling(vx, vy) {
    this.stop();
    let last = performance.now();
    const step = (t) => {
      const dt = Math.min(40, t - last); last = t;
      const bx = this.x; const by = this.y;
      this.panBy(vx * dt, vy * dt);
      const decay = 0.0035;
      vx *= Math.exp(-decay * dt * 1.6); vy *= Math.exp(-decay * dt * 1.6);
      if (this.x === bx) vx = 0;
      if (this.y === by) vy = 0;
      if (Math.abs(vx) + Math.abs(vy) > 0.02) this.anim = requestAnimationFrame(step); else this.anim = null;
    };
    this.anim = requestAnimationFrame(step);
  }
  stop() { if (this.anim) cancelAnimationFrame(this.anim); this.anim = null; }
}

/* ================================================================ PAGINE (slide) */

/** Crea la "pagina" di un documento: immagine o PDF. */
function createSlide(doc, onLoaded) {
  const el = h('<div class="v-slide"><div class="v-content"></div><div class="v-loading"><div class="spinner"></div></div></div>');
  const content = el.querySelector('.v-content');
  const slide = { doc, el, content, destroyed: false, pdf: null, pages: [] };
  slide.zoomer = new Zoomer(el, content, () => { if (slide.pdf) schedulePdfRender(slide); });

  const fail = (e) => {
    if (slide.destroyed) return;
    el.querySelector('.v-loading').innerHTML = `<p class="v-error">Impossibile aprire il documento.<br><small>${esc(e?.message || '')}</small></p>`;
  };

  if (doc.file_type === 'pdf') {
    loadPdfSlide(slide).then(() => onLoaded?.(slide)).catch(fail);
  } else {
    const img = new Image();
    img.decoding = 'async';
    img.draggable = false;
    img.alt = docTitle(doc);
    let retried = false;
    img.onload = () => {
      if (slide.destroyed) return;
      slide.natural = { w: img.naturalWidth, h: img.naturalHeight };
      content.appendChild(img);
      el.querySelector('.v-loading').remove();
      layoutSlide(slide);
      onLoaded?.(slide);
    };
    img.onerror = async () => {
      if (retried || slide.destroyed) { fail(new Error('Immagine non disponibile.')); return; }
      retried = true; // l'URL firmato potrebbe essere scaduto: ne chiediamo uno nuovo
      try { img.src = await refreshSignedUrl(doc.file_path); } catch (e) { fail(e); }
    };
    signedUrl(doc.file_path).then((u) => { if (!slide.destroyed) img.src = u; }).catch(fail);
  }
  slide.destroy = () => {
    slide.destroyed = true; slide.zoomer.stop();
    if (slide.pdf) closePdf(slide.pdf);
    slide.pages.forEach((p) => { if (p.canvas) { p.canvas.width = 0; p.canvas.height = 0; } });
    el.remove();
  };
  return slide;
}

/** Dimensiona il contenuto alla finestra (a scala 1). */
function layoutSlide(slide) {
  const z = slide.zoomer;
  const vw = slide.el.clientWidth; const vh = slide.el.clientHeight;
  if (!vw || !vh) return;
  if (slide.pdf) {
    const bw = Math.min(vw, PDF_MAX_WIDTH);
    let y = 0;
    slide.pages.forEach((p) => {
      p.h = bw * p.ratio; p.y = y;
      Object.assign(p.el.style, { width: `${bw}px`, height: `${p.h}px`, top: `${y}px` });
      y += p.h + PAGE_GAP;
    });
    slide.content.style.width = `${bw}px`;
    slide.content.style.height = `${y - PAGE_GAP}px`;
    z.setBase(bw, y - PAGE_GAP, true);
  } else if (slide.natural) {
    const r = Math.min(vw / slide.natural.w, vh / slide.natural.h);
    const bw = slide.natural.w * r; const bh = slide.natural.h * r;
    slide.content.style.width = `${bw}px`; slide.content.style.height = `${bh}px`;
    z.setBase(bw, bh, false);
  }
}

async function loadPdfSlide(slide) {
  const buf = await fileArrayBuffer(slide.doc.file_path);
  if (slide.destroyed) return;
  const pdf = await openPdf(buf);
  if (slide.destroyed) { closePdf(pdf); return; }
  slide.pdf = pdf;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    if (slide.destroyed) return;
    const vp = page.getViewport({ scale: 1 });
    const el = h('<div class="v-page"></div>');
    slide.content.appendChild(el);
    slide.pages.push({ n: i, page, ratio: vp.height / vp.width, el, canvas: null, rendering: false, rendered: false });
  }
  slide.content.classList.add('pdf');
  slide.el.querySelector('.v-loading')?.remove();
  layoutSlide(slide);
}

/** Disegna solo le pagine vicine alla parte visibile; libera la memoria delle altre. */
function schedulePdfRender(slide) {
  if (slide.renderQueued) return;
  slide.renderQueued = true;
  requestAnimationFrame(() => { slide.renderQueued = false; renderVisiblePages(slide); });
}

async function renderVisiblePages(slide) {
  if (slide.destroyed || !slide.pdf) return;
  const z = slide.zoomer;
  const top = -z.y / z.s; const bottom = (z.vh - z.y) / z.s;
  const margin = z.vh / z.s; // una schermata in più sopra e sotto
  for (const p of slide.pages) {
    const near = p.y + p.h >= top - margin && p.y <= bottom + margin;
    if (near && !p.rendered && !p.rendering) renderPdfPage(slide, p);
    if (!near && p.rendered && Math.abs(p.y - top) > 4 * z.vh / z.s) {
      p.canvas.width = 0; p.canvas.height = 0; p.canvas.remove(); p.canvas = null; p.rendered = false;
    }
  }
}

async function renderPdfPage(slide, p) {
  p.rendering = true;
  try {
    const dpr = window.devicePixelRatio || 1;
    const cssW = parseFloat(p.el.style.width) || 800;
    const targetW = Math.min(PDF_RENDER_MAX, Math.round(cssW * dpr * 1.5));
    const base = p.page.getViewport({ scale: 1 });
    const vp = p.page.getViewport({ scale: targetW / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await p.page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
    if (slide.destroyed) { canvas.width = 0; return; }
    p.canvas = canvas; p.el.appendChild(canvas); p.rendered = true;
  } catch (e) {
    console.warn('Pagina PDF non disegnata', e);
  } finally { p.rendering = false; }
}

/* ================================================================ VIEWER */

/**
 * Apre il visualizzatore.
 * docs: sequenza (già filtrata e ordinata); index: documento da cui partire.
 */
export function openViewer(docs, index = 0) {
  if (current) current.close();
  if (!docs.length) return;
  const v = new Viewer(docs, index);
  current = v;
  return v;
}

class Viewer {
  constructor(docs, index) {
    this.docs = docs;
    this.index = Math.max(0, Math.min(docs.length - 1, index));
    this.slides = { prev: null, cur: null, next: null };
    this.wakeLock = null;

    this.el = h(`<div class="viewer" role="dialog" aria-modal="true" aria-label="Visualizzazione documento">
      <div class="v-track"></div>
      <button type="button" class="v-nav v-prev" aria-label="Documento precedente">‹</button>
      <button type="button" class="v-nav v-next" aria-label="Documento successivo">›</button>
      <div class="v-bar">
        <div class="v-info"><strong class="v-title"></strong><span class="v-artist"></span></div>
        <button type="button" class="v-status" aria-label="Cambia stato"></button>
        <div class="v-stars" role="radiogroup" aria-label="Voto">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-label="${n} stell${n === 1 ? 'a' : 'e'}">★</button>`).join('')}
        </div>
        <button type="button" class="v-close" aria-label="Chiudi">✕ <span>Chiudi</span></button>
      </div>
    </div>`);
    this.track = this.el.querySelector('.v-track');
    document.body.appendChild(this.el);
    document.body.classList.add('viewer-open');

    this.el.querySelector('.v-close').onclick = () => this.close();
    this.el.querySelector('.v-prev').onclick = () => this.go(-1);
    this.el.querySelector('.v-next').onclick = () => this.go(1);
    this.el.querySelector('.v-status').onclick = () => this.cycleStatus();
    this.el.querySelector('.v-stars').addEventListener('click', (e) => {
      const b = e.target.closest('[data-star]'); if (b) this.setStars(+b.dataset.star);
    });
    // i tocchi sulla barra non devono arrivare ai gesti del documento
    this.el.querySelectorAll('.v-bar, .v-nav').forEach((x) => x.addEventListener('pointerdown', (e) => e.stopPropagation()));

    this.bindGestures();
    this.onKey = (e) => this.key(e);
    this.onResize = () => this.relayout();
    this.onVisibility = () => { if (document.visibilityState === 'visible') this.requestWakeLock(); };
    this.onPop = () => this.close(true);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    // Il tasto "indietro" di Android chiude il documento invece di lasciare la pagina
    history.pushState({ tabshelfViewer: true }, '');
    window.addEventListener('popstate', this.onPop);

    this.enterFullscreen();
    this.requestWakeLock();
    this.build();
  }

  /* ---------------------------------------------------------------- pagine */

  build() {
    Object.values(this.slides).forEach((s) => s?.destroy());
    const make = (i) => (i >= 0 && i < this.docs.length ? this.mount(createSlide(this.docs[i])) : null);
    this.slides = { prev: make(this.index - 1), cur: make(this.index), next: make(this.index + 1) };
    this.position(0);
    this.updateBar();
  }

  mount(slide) {
    this.track.appendChild(slide.el);
    requestAnimationFrame(() => layoutSlide(slide));
    return slide;
  }

  /** Posiziona le tre pagine (prec./corrente/succ.) con uno spostamento dx in pixel. */
  position(dx, animate = false) {
    const w = this.track.clientWidth;
    const set = (s, off) => {
      if (!s) return;
      s.el.style.transition = animate ? 'transform .25s ease-out' : 'none';
      s.el.style.transform = `translateX(${off * w + dx}px)`;
    };
    set(this.slides.prev, -1); set(this.slides.cur, 0); set(this.slides.next, 1);
  }

  go(dir) {
    const target = this.index + dir;
    if (target < 0 || target >= this.docs.length) { this.position(0, true); return; }
    const w = this.track.clientWidth;
    this.position(-dir * w, true);
    clearTimeout(this.goTimer);
    this.goTimer = setTimeout(() => this.shift(dir), 250);
  }

  shift(dir) {
    this.index += dir;
    const s = this.slides;
    if (dir > 0) {
      s.prev?.destroy(); s.prev = s.cur; s.cur = s.next;
      s.next = this.index + 1 < this.docs.length ? this.mount(createSlide(this.docs[this.index + 1])) : null;
    } else {
      s.next?.destroy(); s.next = s.cur; s.cur = s.prev;
      s.prev = this.index - 1 >= 0 ? this.mount(createSlide(this.docs[this.index - 1])) : null;
    }
    // le pagine vicine tornano a scala 1
    [s.prev, s.next].forEach((x) => x?.zoomer.reset());
    this.position(0);
    this.updateBar();
  }

  relayout() {
    Object.values(this.slides).forEach((s) => s && layoutSlide(s));
    this.position(0);
  }

  /* ---------------------------------------------------------------- barra */

  get doc() { return this.docs[this.index]; }

  updateBar() {
    const d = state.documents.find((x) => x.id === this.doc.id) || this.doc;
    this.el.querySelector('.v-title').textContent = docTitle(d);
    this.el.querySelector('.v-artist').textContent = d.artist || '';
    const st = STATUSES.find((s) => s.id === d.status) || STATUSES[0];
    const sb = this.el.querySelector('.v-status');
    sb.textContent = st.label; sb.className = `v-status status-${st.id}`;
    this.el.querySelectorAll('.v-stars [data-star]').forEach((b) => {
      const n = +b.dataset.star;
      b.classList.toggle('on', n <= (d.mastery || 0));
      b.setAttribute('aria-checked', String(n === d.mastery));
    });
    this.el.querySelector('.v-prev').hidden = this.index === 0;
    this.el.querySelector('.v-next').hidden = this.index >= this.docs.length - 1;
  }

  async save(patch) {
    const id = this.doc.id;
    const d = state.documents.find((x) => x.id === id);
    const before = { ...d };
    Object.assign(d, patch); this.updateBar();
    try { await updateDocument(id, patch); } catch (e) {
      Object.assign(d, { status: before.status, mastery: before.mastery }); this.updateBar();
      toastError(e, 'Modifica non salvata');
    }
  }

  cycleStatus() {
    const d = state.documents.find((x) => x.id === this.doc.id);
    const i = STATUSES.findIndex((s) => s.id === d.status);
    this.save({ status: STATUSES[(i + 1) % STATUSES.length].id });
  }

  setStars(n) {
    const d = state.documents.find((x) => x.id === this.doc.id);
    this.save({ mastery: d.mastery === n ? null : n }); // toccare di nuovo la stessa stella toglie il voto
  }

  toggleUi() { this.el.classList.toggle('ui-hidden'); }

  /* ---------------------------------------------------------------- gesti */

  bindGestures() {
    const el = this.track;
    const pts = new Map();
    let mode = null;              // 'pan' | 'swipe' | 'pinch'
    let start = null;             // primo tocco
    let last = null;              // ultima posizione (per pan e velocità)
    let vel = { x: 0, y: 0 };
    let pinch = null;
    let swipeDx = 0;
    let lastTap = null; let tapTimer = null;
    let moved = false;

    const z = () => this.slides.cur?.zoomer;
    const center = () => { const a = [...pts.values()]; return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }; };
    const dist = () => { const a = [...pts.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
    const local = (p) => { const r = el.getBoundingClientRect(); return { x: p.x - r.left, y: p.y - r.top }; };

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      z()?.stop();
      if (pts.size === 1) {
        start = { x: e.clientX, y: e.clientY, t: performance.now() };
        last = { x: e.clientX, y: e.clientY, t: performance.now() };
        vel = { x: 0, y: 0 }; mode = null; moved = false; swipeDx = 0;
      } else if (pts.size === 2) {
        if (mode === 'swipe') this.position(0, true);
        mode = 'pinch'; moved = true;
        pinch = { d: dist(), s: z()?.s || 1, c: local(center()) };
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const zz = z(); if (!zz) return;
      if (mode === 'pinch' && pts.size >= 2) {
        const c = local(center());
        const ns = pinch.s * (dist() / pinch.d);
        zz.panBy(c.x - pinch.c.x, c.y - pinch.c.y);
        zz.zoomAt(c.x, c.y, ns);
        pinch.c = c;
        return;
      }
      if (pts.size !== 1) return;
      const dx = e.clientX - start.x; const dy = e.clientY - start.y;
      if (!mode) {
        if (Math.hypot(dx, dy) < 8) return;
        moved = true;
        const zoomed = zz.s > 1.02;
        if (!zoomed && Math.abs(dx) > Math.abs(dy) && !zz.canPanX()) mode = 'swipe';
        else mode = 'pan';
      }
      const now = performance.now();
      const ddx = e.clientX - last.x; const ddy = e.clientY - last.y; const dt = Math.max(1, now - last.t);
      vel = { x: 0.8 * (ddx / dt) + 0.2 * vel.x, y: 0.8 * (ddy / dt) + 0.2 * vel.y };
      last = { x: e.clientX, y: e.clientY, t: now };
      if (mode === 'swipe') {
        swipeDx = dx;
        const atEdge = (dx > 0 && !this.slides.prev) || (dx < 0 && !this.slides.next);
        this.position(atEdge ? dx / 3 : dx);
      } else if (mode === 'pan') {
        zz.panBy(zz.canPanX() ? ddx : 0, zz.canPanY() ? ddy : 0);
      }
    });

    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      const zz = z();
      if (mode === 'pinch') {
        if (pts.size === 1) { // si continua a trascinare con il dito rimasto
          const p = [...pts.values()][0];
          start = { x: p.x, y: p.y, t: performance.now() }; last = { ...start }; mode = 'pan';
        } else if (pts.size === 0) { mode = null; if (zz && zz.s < 1.02) zz.animateZoom(zz.vw / 2, zz.vh / 2, 1); }
        return;
      }
      if (pts.size > 0) return;
      if (mode === 'swipe') {
        const w = this.track.clientWidth;
        const fast = Math.abs(vel.x) > 0.5;
        if ((Math.abs(swipeDx) > w * 0.18 || fast) && swipeDx < 0 && this.slides.next) this.go(1);
        else if ((Math.abs(swipeDx) > w * 0.18 || fast) && swipeDx > 0 && this.slides.prev) this.go(-1);
        else this.position(0, true);
      } else if (mode === 'pan' && zz) {
        if (performance.now() - last.t < 80) zz.fling(vel.x, vel.y);
      } else if (!moved && e.type === 'pointerup') {
        // tocco: singolo (interfaccia) o doppio (zoom)
        const now = performance.now();
        const p = local({ x: e.clientX, y: e.clientY });
        if (lastTap && now - lastTap.t < 300 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 40) {
          clearTimeout(tapTimer); lastTap = null;
          if (zz) zz.animateZoom(p.x, p.y, zz.s > 1.2 ? 1 : 2.5);
        } else {
          lastTap = { ...p, t: now };
          tapTimer = setTimeout(() => { lastTap = null; this.toggleUi(); }, 280);
        }
      }
      mode = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    // PC: rotellina = scorrere, Ctrl+rotellina (o pizzico sul touchpad) = zoom
    el.addEventListener('wheel', (e) => {
      const zz = z(); if (!zz) return;
      e.preventDefault();
      const p = local({ x: e.clientX, y: e.clientY });
      if (e.ctrlKey) zz.zoomAt(p.x, p.y, zz.s * Math.exp(-e.deltaY * 0.01));
      else if (zz.canPanY() || zz.canPanX()) zz.panBy(-e.deltaX, -e.deltaY);
    }, { passive: false });
  }

  key(e) {
    const zz = this.slides.cur?.zoomer;
    if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') { if (!zz?.canPanY() || e.key === 'ArrowRight') this.go(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { if (!zz?.canPanY() || e.key === 'ArrowLeft') this.go(-1); }
    else if (e.key === '+' || e.key === '=') zz?.animateZoom(zz.vw / 2, zz.vh / 2, zz.s * 1.5);
    else if (e.key === '-') zz?.animateZoom(zz.vw / 2, zz.vh / 2, zz.s / 1.5);
    else if (e.key === 'ArrowDown' && zz) zz.panBy(0, -80);
    else if (e.key === 'ArrowUp' && zz) zz.panBy(0, 80);
  }

  /* ---------------------------------------------------------------- schermo */

  enterFullscreen() {
    const d = document.documentElement;
    if (!document.fullscreenElement && d.requestFullscreen) d.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }

  async requestWakeLock() {
    if (!('wakeLock' in navigator) || this.closed) return;
    try {
      if (this.wakeLock && !this.wakeLock.released) return;
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* non supportato o non permesso: si ignora */ }
  }

  close(fromHistory = false) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.goTimer);
    Object.values(this.slides).forEach((s) => s?.destroy());
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('popstate', this.onPop);
    try { this.wakeLock?.release(); } catch { /* niente */ }
    this.wakeLock = null;
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    this.el.remove();
    document.body.classList.remove('viewer-open');
    if (!fromHistory && history.state?.tabshelfViewer) history.back();
    if (current === this) current = null;
    this.onClose?.(this.doc);
  }
}
