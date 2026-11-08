/**
 * practice.js — Modalità pratica: schermo intero scuro-neutro con la tablatura
 * in primo piano, navigazione avanti/indietro (tasti, swipe, pulsanti), zoom,
 * scorrimento automatico per le tablature lunghe, preferito e schermo sempre acceso.
 */
import * as S from './store.js';
import { esc, html, tabTitle, errorMessage } from './utils.js';
import { toast } from './ui.js';

let active = null;
export const isPracticeOpen = () => !!active;

/** Livelli di zoom: 0 = intera immagine nello schermo, 1 = a tutta larghezza (scorre in verticale), poi ingrandimenti. */
const ZOOMS = [0, 1, 1.5, 2, 3];
/** Velocità di scorrimento automatico (px al secondo). */
const SPEEDS = [12, 25, 45, 75, 120];

/**
 * Avvia la modalità pratica.
 * ids: elenco ordinato delle tablature; opts.title: nome della sessione.
 */
export function openPractice(ids, { title = '' } = {}) {
  let list = ids.filter((id) => S.state.tabs.has(id));
  if (!list.length) { toast('Nessuna tablatura da esercitare in questa selezione.', { type: 'warn' }); return null; }
  if (active) active.close();

  let idx = 0; let zoomIdx = 0; let speedIdx = 1; let playing = false; let uiHidden = false;
  let raf = 0; let lastT = 0; let acc = 0; let token = 0; let wake = null;

  const root = html(`<div class="practice" role="dialog" aria-modal="true" aria-label="Modalità pratica">
    <div class="pr-top pr-ui">
      <button type="button" class="pr-btn" data-a="close" aria-label="Esci dalla modalità pratica">✕</button>
      <div class="pr-title"><span class="pr-name"></span><span class="pr-meta"></span></div>
      <span class="pr-counter" aria-live="polite"></span>
    </div>
    <div class="pr-stage" tabindex="-1"><img class="pr-img" alt="" draggable="false"><span class="pr-msg"></span></div>
    <div class="pr-bottom pr-ui">
      <button type="button" class="pr-btn big" data-a="prev" aria-label="Precedente">‹</button>
      <button type="button" class="pr-btn" data-a="zout" aria-label="Riduci zoom">−</button>
      <button type="button" class="pr-btn" data-a="zin" aria-label="Ingrandisci">＋</button>
      <button type="button" class="pr-btn" data-a="play" aria-pressed="false" aria-label="Scorrimento automatico">▶ Scorri</button>
      <button type="button" class="pr-btn" data-a="slower" aria-label="Più lento">🐢</button>
      <button type="button" class="pr-btn" data-a="faster" aria-label="Più veloce">🐇</button>
      <button type="button" class="pr-btn" data-a="fav" aria-label="Preferito">☆</button>
      <button type="button" class="pr-btn" data-a="full" aria-label="Schermo intero">⛶</button>
      <button type="button" class="pr-btn big" data-a="next" aria-label="Successiva">›</button>
    </div>
  </div>`);
  const stage = root.querySelector('.pr-stage');
  const img = root.querySelector('.pr-img');
  const msg = root.querySelector('.pr-msg');
  const $ = (a) => root.querySelector(`[data-a=${a}]`);
  const cur = () => S.state.tabs.get(list[idx]);

  /* ------------------------------------------------------------ vista */
  function applyZoom() {
    const z = ZOOMS[zoomIdx];
    stage.classList.toggle('zoomed', z !== 0);
    if (z === 0) { img.style.width = ''; }
    else img.style.width = `${Math.round(stage.clientWidth * z)}px`;
    $('zout').disabled = zoomIdx === 0;
    $('zin').disabled = zoomIdx === ZOOMS.length - 1;
  }

  function updateChrome() {
    const t = cur(); if (!t) return;
    root.querySelector('.pr-name').textContent = tabTitle(t);
    const meta = [t.categoryIds.find((c) => S.state.categories.has(c)) ? S.categoryPath(t.categoryIds.find((c) => S.state.categories.has(c))) : '', t.caged.join(', '), [...t.keys, t.customKey].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    root.querySelector('.pr-meta').textContent = meta || title;
    root.querySelector('.pr-counter').textContent = `${idx + 1} / ${list.length}`;
    $('prev').disabled = idx === 0; $('next').disabled = idx === list.length - 1;
    const fav = $('fav'); fav.textContent = t.favorite ? '★' : '☆'; fav.classList.toggle('on', t.favorite); fav.setAttribute('aria-pressed', String(t.favorite));
    $('play').setAttribute('aria-pressed', String(playing)); $('play').classList.toggle('on', playing);
    $('play').textContent = playing ? '⏸ Pausa' : '▶ Scorri';
  }

  async function show() {
    const t = cur(); if (!t) return;
    const my = ++token;
    stopScroll();
    updateChrome();
    msg.textContent = 'Caricamento…'; img.style.visibility = 'hidden';
    stage.scrollTo(0, 0);
    try {
      const url = await S.getImageURL(t.imageId);
      if (my !== token) return;
      img.onload = () => { if (my === token) { msg.textContent = ''; img.style.visibility = ''; applyZoom(); } };
      img.onerror = () => { if (my === token) msg.textContent = 'Immagine non leggibile.'; };
      img.src = url;
      const nx = S.state.tabs.get(list[idx + 1]); if (nx) S.getImageURL(nx.imageId).catch(() => {});
    } catch (e) { if (my === token) msg.textContent = errorMessage(e); }
  }

  const go = (d) => { const n = idx + d; if (n < 0 || n >= list.length) return; idx = n; show(); };

  /* ------------------------------------------------------------ scorrimento automatico */
  function frame(ts) {
    if (!playing) return;
    const dt = Math.min(0.1, (ts - lastT) / 1000); lastT = ts;
    // scrollTop è intero: accumulo i decimali per velocità basse
    acc += SPEEDS[speedIdx] * dt;
    const step = Math.floor(acc);
    if (step >= 1) {
      acc -= step;
      const before = stage.scrollTop;
      stage.scrollTop = before + step;
      if (Math.abs(stage.scrollTop - before) < 1 && stage.scrollHeight > stage.clientHeight + 2) { stopScroll(); toast('Fine della tablatura.', { duration: 1500 }); return; }
    }
    raf = requestAnimationFrame(frame);
  }
  function startScroll() {
    if (ZOOMS[zoomIdx] === 0) { zoomIdx = 1; applyZoom(); } // per scorrere serve almeno "a tutta larghezza"
    if (stage.scrollHeight <= stage.clientHeight + 2) { toast('La tablatura entra nello schermo: non serve scorrere.', { duration: 2000 }); return; }
    playing = true; lastT = performance.now(); acc = 0; updateChrome();
    raf = requestAnimationFrame(frame);
  }
  function stopScroll() { playing = false; cancelAnimationFrame(raf); updateChrome(); }

  /* ------------------------------------------------------------ schermo sempre acceso */
  async function lockScreen() {
    try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch { /* non disponibile */ }
  }
  const onVis = () => { if (document.visibilityState === 'visible' && active) lockScreen(); };

  /* ------------------------------------------------------------ comandi */
  const actions = {
    close: () => close(),
    prev: () => go(-1),
    next: () => go(1),
    zin: () => { zoomIdx = Math.min(ZOOMS.length - 1, zoomIdx + 1); applyZoom(); },
    zout: () => { if (playing && zoomIdx <= 1) return; zoomIdx = Math.max(0, zoomIdx - 1); applyZoom(); },
    play: () => (playing ? stopScroll() : startScroll()),
    slower: () => { speedIdx = Math.max(0, speedIdx - 1); toast(`Velocità ${speedIdx + 1}/${SPEEDS.length}`, { duration: 900 }); },
    faster: () => { speedIdx = Math.min(SPEEDS.length - 1, speedIdx + 1); toast(`Velocità ${speedIdx + 1}/${SPEEDS.length}`, { duration: 900 }); },
    fav: () => { const t = cur(); if (t) S.updateTab(t.id, { favorite: !t.favorite }).catch((e) => toast(errorMessage(e), { type: 'error' })); },
    full: () => {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else if (root.requestFullscreen) root.requestFullscreen().catch(() => toast('Schermo intero non disponibile su questo dispositivo.', { type: 'warn' }));
      else toast('Schermo intero non disponibile su questo dispositivo.', { type: 'warn' });
    },
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (b && actions[b.dataset.a]) { actions[b.dataset.a](); return; }
    // tocco sull'immagine: mostra/nasconde i comandi (se non era un trascinamento)
    if (e.target.closest('.pr-stage') && !moved) { uiHidden = !uiHidden; root.classList.toggle('ui-hidden', uiHidden); requestAnimationFrame(applyZoom); }
  });

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'Escape' && !document.fullscreenElement) close();
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); go(-1); }
    else if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); go(1); }
    else if (k === ' ') { e.preventDefault(); actions.play(); }
    else if (k === '+' || k === '=') actions.zin();
    else if (k === '-') actions.zout();
    else if (k === 'f' || k === 'F') actions.fav();
    else if (k === 'h' || k === 'H') { uiHidden = !uiHidden; root.classList.toggle('ui-hidden', uiHidden); requestAnimationFrame(applyZoom); }
  }
  document.addEventListener('keydown', onKey);

  // Swipe orizzontale per cambiare tablatura (solo a zoom 0, quando non c'è nulla da scorrere)
  let sx = null; let sy = null; let moved = false;
  stage.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; moved = false; });
  stage.addEventListener('pointermove', (e) => { if (sx !== null && (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8)) moved = true; });
  stage.addEventListener('pointerup', (e) => {
    if (sx === null) return;
    const dx = e.clientX - sx; const dy = e.clientY - sy; sx = null;
    if (ZOOMS[zoomIdx] === 0 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    setTimeout(() => { moved = false; }, 0);
  });
  stage.addEventListener('wheel', () => { if (playing) { /* lo scorrimento manuale convive con quello automatico */ } }, { passive: true });
  window.addEventListener('resize', applyZoom);
  document.addEventListener('visibilitychange', onVis);

  const unsub = S.onChange(() => {
    list = list.filter((id) => S.state.tabs.has(id));
    if (!list.length) { close(); return; }
    const t = cur();
    if (!t) { idx = Math.min(idx, list.length - 1); show(); return; }
    updateChrome();
  });

  function close() {
    if (!active) return;
    stopScroll(); unsub();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('resize', applyZoom);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    try { wake && wake.release(); } catch { /* ignorato */ }
    root.remove();
    document.body.classList.remove('practice-open');
    S.releaseFullImages();
    active = null;
  }

  active = { close };
  document.body.appendChild(root);
  document.body.classList.add('practice-open');
  lockScreen();
  show();
  stage.focus();
  return active;
}
