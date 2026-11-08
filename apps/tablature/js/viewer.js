/**
 * viewer.js — Visualizzatore a schermo intero di una tablatura: zoom, scorrimento
 * tra le tablature dell'elenco, scheda informativa, preferito, modifica,
 * duplicazione, eliminazione e download dell'immagine/originale.
 */
import * as S from './store.js';
import { esc, html, tabTitle, formatDate, formatBytes, downloadBlob, extFromMime, errorMessage } from './utils.js';
import { openModal, toast, guard } from './ui.js';
import { openTabForm } from './tabform.js';

/** Funzione di eliminazione fornita da app.js (conferma + "Annulla"): (ids) => Promise<snapshot|null>. */
let deleteHandler = null;
export function setDeleteHandler(fn) { deleteHandler = fn; }

const ZOOM_STEPS = [1, 1.5, 2, 3, 4, 6];

/** Nome file sicuro a partire da un titolo. */
function safeName(s) {
  return String(s || 'tablatura').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'tablatura';
}

/**
 * Apre il visualizzatore.
 * ids: elenco ordinato di tablature su cui scorrere; index: posizione iniziale.
 */
export function openViewer(ids, index = 0) {
  let list = ids.filter((id) => S.state.tabs.has(id));
  if (!list.length) return null;
  let idx = Math.min(Math.max(0, index), list.length - 1);
  let zoomIdx = 0;
  let token = 0; // evita che un'immagine lenta sovrascriva quella corrente

  const body = html(`<div class="viewer">
    <div class="viewer-stage"><img class="viewer-img" alt="" draggable="false"><div class="viewer-loading"><div class="spinner" aria-hidden="true"></div></div></div>
    <div class="viewer-zoom btn-row">
      <button type="button" class="btn sm" data-z="out" aria-label="Riduci zoom">−</button>
      <span class="zoom-val small" aria-live="polite">Adatta</span>
      <button type="button" class="btn sm" data-z="in" aria-label="Ingrandisci">＋</button>
      <button type="button" class="btn sm" data-z="fit">Adatta</button>
    </div>
    <aside class="viewer-info" aria-label="Dettagli tablatura"></aside>
  </div>`);
  const footer = html(`<div class="viewer-footer btn-row">
    <button type="button" class="btn" data-n="prev" aria-label="Tablatura precedente">‹ Precedente</button>
    <span class="viewer-counter small muted" aria-live="polite"></span>
    <button type="button" class="btn" data-n="next" aria-label="Tablatura successiva">Successiva ›</button>
  </div>`);

  const stage = body.querySelector('.viewer-stage');
  const img = body.querySelector('.viewer-img');
  const loading = body.querySelector('.viewer-loading');
  const info = body.querySelector('.viewer-info');
  const zoomVal = body.querySelector('.zoom-val');

  const unsub = S.onChange(() => refreshAfterChange());
  const modal = openModal({
    title: '', size: 'full', body, footer,
    onClose: () => { unsub(); document.removeEventListener('keydown', onKey); S.releaseFullImages(); },
  });
  const titleEl = modal.el.querySelector('.modal-title');
  const current = () => S.state.tabs.get(list[idx]);

  /* ------------------------------------------------------------ zoom */
  function applyZoom() {
    const z = ZOOM_STEPS[zoomIdx];
    if (z === 1) { img.classList.remove('zoomed'); img.style.width = ''; }
    else { img.classList.add('zoomed'); img.style.width = `${Math.round(stage.clientWidth * z)}px`; }
    zoomVal.textContent = z === 1 ? 'Adatta' : `${Math.round(z * 100)}%`;
    body.querySelector('[data-z=out]').disabled = zoomIdx === 0;
    body.querySelector('[data-z=in]').disabled = zoomIdx === ZOOM_STEPS.length - 1;
  }
  const setZoom = (i) => { zoomIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, i)); applyZoom(); if (zoomIdx === 0) stage.scrollTo(0, 0); };
  body.querySelector('[data-z=in]').onclick = () => setZoom(zoomIdx + 1);
  body.querySelector('[data-z=out]').onclick = () => setZoom(zoomIdx - 1);
  body.querySelector('[data-z=fit]').onclick = () => setZoom(0);
  img.addEventListener('dblclick', () => setZoom(zoomIdx === 0 ? 2 : 0));
  stage.addEventListener('wheel', (e) => { if (!e.ctrlKey) return; e.preventDefault(); setZoom(zoomIdx + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
  window.addEventListener('resize', applyZoom, { once: false });
  const origClose = modal.close;
  modal.close = (r) => { window.removeEventListener('resize', applyZoom); origClose(r); };

  /* ------------------------------------------------------------ contenuto */
  async function show() {
    const t = current();
    if (!t) return;
    const my = ++token;
    titleEl.textContent = tabTitle(t);
    footer.querySelector('.viewer-counter').textContent = `${idx + 1} / ${list.length}`;
    footer.querySelector('[data-n=prev]').disabled = idx === 0;
    footer.querySelector('[data-n=next]').disabled = idx === list.length - 1;
    renderInfo();
    zoomIdx = 0; applyZoom();
    stage.scrollTo(0, 0);
    loading.hidden = false; img.style.visibility = 'hidden';
    try {
      const url = await S.getImageURL(t.imageId);
      if (my !== token) return;
      img.onload = () => { if (my === token) { loading.hidden = true; img.style.visibility = ''; } };
      img.onerror = () => { if (my === token) { loading.hidden = true; toast('Immagine non leggibile.', { type: 'error' }); } };
      img.alt = `Tablatura: ${tabTitle(t)}`;
      img.src = url;
      preload(idx + 1);
    } catch (e) {
      if (my !== token) return;
      loading.hidden = true;
      toast(errorMessage(e), { type: 'error' });
    }
  }

  function preload(i) {
    const t = S.state.tabs.get(list[i]);
    if (t) S.getImageURL(t.imageId).catch(() => {});
  }

  function renderInfo() {
    const t = current(); if (!t) return;
    const cats = t.categoryIds.filter((c) => S.state.categories.has(c));
    const caged = t.cagedOrdered ? t.caged.join(' → ') : t.caged.join(', ');
    const keys = [...t.keys, ...(t.customKey ? [t.customKey] : [])].join(', ');
    info.innerHTML = `
      <div class="vi-head"><strong class="grow ellipsis">${esc(tabTitle(t))}</strong>
        <button type="button" class="star big ${t.favorite ? 'on' : ''}" data-v="fav" aria-pressed="${t.favorite}" aria-label="Preferito">${t.favorite ? '★' : '☆'}</button></div>
      ${t.description ? `<p class="small">${esc(t.description)}</p>` : ''}
      <dl class="meta-list">
        <dt>Categorie</dt><dd>${cats.length ? cats.map((c) => `<a href="#/categoria/${esc(c)}" data-close>${esc(S.categoryPath(c))}</a>`).join('<br>') : '<span class="muted">Senza categoria</span>'}</dd>
        ${caged ? `<dt>CAGED</dt><dd>${esc(caged)}</dd>` : ''}
        ${keys ? `<dt>Tonalità</dt><dd>${esc(keys)}</dd>` : ''}
        ${t.notes ? `<dt>Note</dt><dd class="pre">${esc(t.notes)}</dd>` : ''}
        <dt>Aggiunta</dt><dd>${formatDate(t.createdAt, true)}</dd>
        ${t.updatedAt !== t.createdAt ? `<dt>Modificata</dt><dd>${formatDate(t.updatedAt, true)}</dd>` : ''}
        <dt>Immagine</dt><dd>${t.imgWidth} × ${t.imgHeight} px · ${formatBytes(t.imageSize)}</dd>
      </dl>
      <div class="btn-row wrap" style="margin-top:12px">
        <button type="button" class="btn sm primary" data-v="edit">✎ Modifica</button>
        <button type="button" class="btn sm" data-v="dup">⧉ Duplica</button>
        <button type="button" class="btn sm" data-v="dl">⬇ Immagine</button>
        ${t.originalId ? '<button type="button" class="btn sm" data-v="dlo">⬇ Originale</button>' : ''}
        <button type="button" class="btn sm danger" data-v="del">🗑 Elimina</button>
      </div>`;
  }

  info.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { modal.close(); return; } // il link cambia la pagina sottostante
    const b = e.target.closest('[data-v]'); if (!b) return;
    const t = current(); if (!t) return;
    const a = b.dataset.v;
    if (a === 'fav') guard(() => S.updateTab(t.id, { favorite: !t.favorite }));
    else if (a === 'edit') openTabForm({ id: t.id });
    else if (a === 'dup') guard(async () => { await S.duplicateTab(t.id); toast('Tablatura duplicata.', { type: 'success' }); });
    else if (a === 'dl') guard(async () => { const r = await S.getImageBlob(t.imageId); downloadBlob(r.blob, `${safeName(tabTitle(t))}.${extFromMime(r.mime || r.blob.type)}`); });
    else if (a === 'dlo') guard(async () => { const r = await S.getImageBlob(t.originalId); downloadBlob(r.blob, r.name || `${safeName(tabTitle(t))}-originale.${extFromMime(r.mime || r.blob.type)}`); });
    else if (a === 'del' && deleteHandler) deleteHandler([t.id]); // l'aggiornamento arriva da onChange
  });

  /** Dopo una modifica ai dati: aggiorna scheda, oppure passa oltre se la tablatura è stata eliminata. */
  function refreshAfterChange() {
    const curId = list[idx];
    const alive = list.filter((id) => S.state.tabs.has(id));
    if (!alive.length) { modal.close(); return; }
    if (!S.state.tabs.has(curId)) {
      const removedBefore = list.slice(0, idx).filter((id) => !S.state.tabs.has(id)).length;
      list = alive;
      idx = Math.min(Math.max(0, idx - removedBefore), list.length - 1);
      show();
      return;
    }
    list = alive; idx = list.indexOf(curId);
    const t = current();
    titleEl.textContent = tabTitle(t);
    footer.querySelector('.viewer-counter').textContent = `${idx + 1} / ${list.length}`;
    footer.querySelector('[data-n=prev]').disabled = idx === 0;
    footer.querySelector('[data-n=next]').disabled = idx === list.length - 1;
    renderInfo();
    // Immagine sostituita in modifica: ricarica solo se l'URL è cambiato
    S.getImageURL(t.imageId).then((u) => { if (img.src !== u) { img.src = u; } }).catch(() => {});
  }

  /* ------------------------------------------------------------ navigazione */
  const go = (d) => { const n = idx + d; if (n < 0 || n >= list.length) return; idx = n; show(); };
  footer.querySelector('[data-n=prev]').onclick = () => go(-1);
  footer.querySelector('[data-n=next]').onclick = () => go(1);

  function onKey(e) {
    if (e.target.matches && e.target.matches('input, textarea, select')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Se sopra il visualizzatore c'è un'altra finestra (es. il form di modifica) non intercetto i tasti
    const top = document.querySelectorAll('.modal-backdrop');
    if (top[top.length - 1] !== modal.el) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === '+' || e.key === '=') setZoom(zoomIdx + 1);
    else if (e.key === '-') setZoom(zoomIdx - 1);
    else if (e.key === '0') setZoom(0);
  }
  document.addEventListener('keydown', onKey);

  // Scorrimento con swipe orizzontale (solo a zoom "Adatta")
  let sx = null; let sy = null;
  stage.addEventListener('touchstart', (e) => { if (zoomIdx === 0 && e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; } else sx = null; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx; const dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  show();
  return modal;
}
