/**
 * archive.js — Pagina Archivio: elenco/griglia delle tablature, ambiti (tutte,
 * preferiti, senza categoria, categoria), ricerca, filtri CAGED/tonalità,
 * ordinamento, selezione multipla con azioni di gruppo, eliminazione con "Annulla".
 */
import * as S from './store.js';
import { esc, html, norm, collator, CAGED_SHAPES, KEYS, tabTitle, formatDate } from './utils.js';
import { toast, confirmDialog, guard } from './ui.js';
import { openTabForm, openBulkEdit } from './tabform.js';
import { openViewer } from './viewer.js';

/** Quante tablature disegnare per volta (le altre arrivano scorrendo). */
const PAGE_SIZE = 60;

/** Stato della vista corrente (condiviso con app.js). */
export const view = {
  scope: 'all',          // all | favorites | uncategorized | category
  categoryId: null,
  query: '',
  caged: [],             // filtro: almeno una delle forme selezionate
  keys: [],              // filtro: almeno una delle tonalità selezionate
  onlyFav: false,
  filtersOpen: false,
  selecting: false,
  selected: new Set(),
  limit: PAGE_SIZE,
};

const SORTS = [
  ['createdAt-desc', 'Più recenti'],
  ['createdAt-asc', 'Più vecchie'],
  ['title-asc', 'Titolo A→Z'],
  ['title-desc', 'Titolo Z→A'],
  ['updatedAt-desc', 'Modificate di recente'],
  ['manual', 'Ordine manuale'],
];

/* ================================================================ AMBITO / FILTRI */

export function setScope(scope, categoryId = null) {
  const changed = view.scope !== scope || (view.categoryId || null) !== (categoryId || null);
  view.scope = scope; view.categoryId = categoryId || null;
  if (changed) { view.limit = PAGE_SIZE; view.selected.clear(); view.selecting = false; }
}

/** Azzera ambito, ricerca e filtri (usato dopo l'eliminazione dell'archivio). */
export function resetFilters() {
  Object.assign(view, { scope: 'all', categoryId: null, query: '', caged: [], keys: [], onlyFav: false, selecting: false, limit: PAGE_SIZE });
  view.selected.clear();
  const si = document.getElementById('search-input');
  if (si) si.value = '';
}

let searchTimer = null;
/** Chiamata da app.js a ogni digitazione nella casella di ricerca. */
export function onSearchInput(value) {
  view.query = value;
  view.limit = PAGE_SIZE;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => S.emitChange('search'), 150);
}

function activeFilterCount() {
  return (view.caged.length ? 1 : 0) + (view.keys.length ? 1 : 0) + (view.onlyFav ? 1 : 0);
}

/** Tablature dell'ambito corrente dopo ricerca, filtri e ordinamento. */
export function getFilteredTabs() {
  let list = [...S.state.tabs.values()];
  const cats = S.state.categories;

  if (view.scope === 'favorites') list = list.filter((t) => t.favorite);
  else if (view.scope === 'uncategorized') list = list.filter((t) => !t.categoryIds.some((c) => cats.has(c)));
  else if (view.scope === 'category' && view.categoryId) {
    const ids = new Set([view.categoryId]);
    if (S.state.settings.includeSubcategories !== false) S.descendantIds(view.categoryId).forEach((i) => ids.add(i));
    list = list.filter((t) => t.categoryIds.some((c) => ids.has(c)));
  }

  if (view.onlyFav) list = list.filter((t) => t.favorite);
  if (view.caged.length) list = list.filter((t) => t.caged.some((c) => view.caged.includes(c)));
  if (view.keys.length) list = list.filter((t) => t.keys.some((k) => view.keys.includes(k)));

  const tokens = norm(view.query).split(/\s+/).filter(Boolean);
  if (tokens.length) {
    const pathCache = new Map();
    const pathOf = (id) => { if (!pathCache.has(id)) pathCache.set(id, norm(S.categoryPath(id))); return pathCache.get(id); };
    list = list.filter((t) => {
      const hay = norm([t.title, t.description, t.notes, t.customKey, t.originalName, t.caged.join(' '), t.keys.join(' ')].join(' '))
        + ' ' + t.categoryIds.map(pathOf).join(' ') + (t.favorite ? ' preferito preferiti' : '');
      return tokens.every((tk) => hay.includes(tk));
    });
  }

  const [field, dir] = String(S.state.settings.sortBy || 'createdAt-desc').split('-');
  const sign = dir === 'asc' ? 1 : -1;
  if (S.state.settings.sortBy === 'manual') list.sort((a, b) => a.order - b.order);
  else if (field === 'title') list.sort((a, b) => sign * collator.compare(tabTitle(a), tabTitle(b)));
  else list.sort((a, b) => sign * (Date.parse(a[field]) - Date.parse(b[field])));
  return list;
}

/* ================================================================ ELIMINAZIONE */

/** Chiede conferma, elimina e propone "Annulla". Restituisce lo snapshot o null. */
export async function deleteWithUndo(ids) {
  ids = [...ids].filter((id) => S.state.tabs.has(id));
  if (!ids.length) return null;
  const name = ids.length === 1 ? `"${tabTitle(S.state.tabs.get(ids[0]))}"` : `${ids.length} tablature`;
  if (!(await confirmDialog(`Eliminare ${name}? Subito dopo potrai annullare.`, { title: 'Elimina', okLabel: 'Elimina', danger: true }))) return null;
  return guard(async () => {
    const snapshot = await S.deleteTabs(ids);
    ids.forEach((id) => view.selected.delete(id));
    toast(ids.length === 1 ? 'Tablatura eliminata.' : `${ids.length} tablature eliminate.`, {
      duration: 8000,
      action: { label: 'Annulla', onClick: async () => { await S.restoreDeleted(snapshot); toast('Eliminazione annullata.', { type: 'success' }); } },
    });
    return snapshot;
  });
}

/* ================================================================ RENDER */

const IO_THUMBS = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      IO_THUMBS.unobserve(en.target);
      loadThumb(en.target);
    }
  }, { rootMargin: '300px' })
  : null;

async function loadThumb(img) {
  try {
    img.src = await S.getImageURL(img.dataset.thumb);
    img.onload = () => img.classList.add('loaded');
    img.onerror = () => img.classList.add('broken');
  } catch { img.classList.add('broken'); }
}

function scopeTitle() {
  if (view.scope === 'favorites') return '★ Preferiti';
  if (view.scope === 'uncategorized') return '📥 Senza categoria';
  if (view.scope === 'category') {
    const c = S.state.categories.get(view.categoryId);
    return c ? `${c.icon ? c.icon + ' ' : ''}${c.name}` : 'Categoria';
  }
  return 'Tutte le tablature';
}

function crumbsHTML() {
  if (view.scope !== 'category') return '';
  const chain = S.ancestry(view.categoryId).slice(0, -1);
  if (!chain.length) return '';
  return `<div class="crumbs small">${chain.map((c) => `<button type="button" class="crumb" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join(' › ')} ›</div>`;
}

function itemHTML(t, mode, manual, canUp, canDown) {
  const sel = view.selected.has(t.id);
  const title = tabTitle(t);
  const firstCat = t.categoryIds.find((c) => S.state.categories.has(c));
  const extra = t.categoryIds.filter((c) => S.state.categories.has(c)).length - 1;
  const path = firstCat ? S.categoryPath(firstCat) + (extra > 0 ? ` +${extra}` : '') : 'Senza categoria';
  const badges = [
    ...t.caged.map((c) => `<span class="badge caged">${esc(c.replace('-Shape', ''))}</span>`),
    ...t.keys.map((k) => `<span class="badge key">${esc(k)}</span>`),
    ...(t.customKey ? [`<span class="badge key">${esc(t.customKey)}</span>`] : []),
  ].join('');
  const star = `<button type="button" class="star ${t.favorite ? 'on' : ''}" data-act="fav" aria-pressed="${t.favorite}" aria-label="${t.favorite ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}" title="Preferito">${t.favorite ? '★' : '☆'}</button>`;
  const actions = `<span class="card-actions">
      ${manual ? `<button type="button" class="icon-btn" data-act="up" aria-label="Sposta su" title="Sposta prima" ${canUp ? '' : 'disabled'}>↑</button>
      <button type="button" class="icon-btn" data-act="down" aria-label="Sposta giù" title="Sposta dopo" ${canDown ? '' : 'disabled'}>↓</button>` : ''}
      <button type="button" class="icon-btn" data-act="edit" aria-label="Modifica ${esc(title)}" title="Modifica">✎</button>
      <button type="button" class="icon-btn" data-act="dup" aria-label="Duplica" title="Duplica">⧉</button>
      <button type="button" class="icon-btn danger" data-act="del" aria-label="Elimina ${esc(title)}" title="Elimina">🗑</button>
    </span>`;
  const thumb = `<img class="thumb" data-thumb="${esc(t.thumbId)}" alt="Anteprima di ${esc(title)}" width="${t.imgWidth || ''}" height="${t.imgHeight || ''}" decoding="async">`;
  const check = `<input type="checkbox" class="sel-box" data-act="sel" aria-label="Seleziona ${esc(title)}" ${sel ? 'checked' : ''}>`;
  if (mode === 'list') {
    return `<article class="row ${sel ? 'selected' : ''}" data-id="${esc(t.id)}">${check}
      <button type="button" class="row-thumb" data-act="open" aria-label="Apri ${esc(title)}">${thumb}</button>
      <div class="row-main"><div class="card-top">${star}<span class="card-title">${esc(title)}</span></div>
        <div class="card-path small">${esc(path)}</div>${t.description ? `<div class="small muted ellipsis">${esc(t.description)}</div>` : ''}</div>
      <div class="row-meta"><div class="badges">${badges}</div><span class="small muted">${formatDate(t.createdAt)}</span></div>
      ${actions}</article>`;
  }
  return `<article class="card ${sel ? 'selected' : ''}" data-id="${esc(t.id)}">${check}
    <button type="button" class="thumb-btn" data-act="open" aria-label="Apri ${esc(title)}">${thumb}</button>
    <div class="card-body"><div class="card-top">${star}<span class="card-title" title="${esc(title)}">${esc(title)}</span></div>
      <div class="card-path small">${esc(path)}</div>
      <div class="card-foot"><div class="badges">${badges}</div>${actions}</div></div></article>`;
}

function filtersHTML() {
  return `<div class="filters-panel" id="filters-panel">
    <label class="check"><input type="checkbox" data-f="fav" ${view.onlyFav ? 'checked' : ''}> Solo preferiti</label>
    <div class="field"><span class="label">Forme CAGED <small class="muted">(almeno una)</small></span>
      <div class="chips" data-f="caged">${CAGED_SHAPES.map((c) => `<button type="button" class="chip" data-v="${c}" aria-pressed="${view.caged.includes(c)}">${c}</button>`).join('')}</div></div>
    <div class="field"><span class="label">Tonalità <small class="muted">(almeno una)</small></span>
      <div class="chips keys" data-f="keys">${KEYS.map((k) => `<button type="button" class="chip" data-v="${k}" aria-pressed="${view.keys.includes(k)}">${k}</button>`).join('')}</div></div>
    <div class="btn-row"><button type="button" class="btn sm" data-f="reset">Azzera filtri</button></div></div>`;
}

export function renderArchive(main) {
  const y = window.scrollY;
  const all = getFilteredTabs();
  const total = S.state.tabs.size;
  const st = S.state.settings;
  const mode = st.viewMode === 'list' ? 'list' : 'grid';
  const manual = st.sortBy === 'manual';
  const nFilters = activeFilterCount();
  const ids = all.map((t) => t.id);
  view.selected = new Set([...view.selected].filter((id) => S.state.tabs.has(id)));

  main.innerHTML = `
    <div class="archive-head">
      <div>${crumbsHTML()}<h1>${esc(scopeTitle())} <span class="count-badge">${all.length}</span></h1></div>
      <div class="btn-row wrap archive-tools">
        <select class="sort-select" aria-label="Ordina per">${SORTS.map(([v, l]) => `<option value="${v}" ${st.sortBy === v || (!st.sortBy && v === 'createdAt-desc') ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <div class="seg" role="group" aria-label="Vista">
          <button type="button" class="seg-btn ${mode === 'grid' ? 'on' : ''}" data-mode="grid" aria-pressed="${mode === 'grid'}" title="Griglia" aria-label="Griglia">▦</button>
          <button type="button" class="seg-btn ${mode === 'list' ? 'on' : ''}" data-mode="list" aria-pressed="${mode === 'list'}" title="Elenco" aria-label="Elenco">☰</button>
        </div>
        <button type="button" class="btn ${view.filtersOpen || nFilters ? 'primary' : ''}" data-a="filters" aria-expanded="${view.filtersOpen}" aria-controls="filters-panel">Filtri${nFilters ? ` (${nFilters})` : ''}</button>
        <button type="button" class="btn ${view.selecting ? 'primary' : ''}" data-a="select" aria-pressed="${view.selecting}">☑ Seleziona</button>
      </div>
    </div>
    ${view.filtersOpen ? filtersHTML() : ''}
    ${(view.query.trim() || nFilters) ? `<div class="active-filters small">${view.query.trim() ? `Ricerca: <strong>${esc(view.query.trim())}</strong> · ` : ''}${all.length} risultat${all.length === 1 ? 'o' : 'i'} su ${total}
      <button type="button" class="link" data-f="clear-all">Rimuovi ricerca e filtri</button></div>` : ''}
    <div class="tabs-container ${mode} ${view.selecting ? 'selecting' : ''}"></div>
    <div class="load-more" hidden></div>
    ${view.selecting ? `<div class="bulk-bar" role="toolbar" aria-label="Azioni sulle selezionate">
      <span class="bulk-count">${view.selected.size} selezionat${view.selected.size === 1 ? 'a' : 'e'}</span>
      <button type="button" class="btn sm" data-b="all">Seleziona tutte (${all.length})</button>
      <button type="button" class="btn sm" data-b="none">Nessuna</button>
      <button type="button" class="btn sm primary" data-b="edit" ${view.selected.size ? '' : 'disabled'}>✎ Modifica</button>
      <button type="button" class="btn sm danger" data-b="del" ${view.selected.size ? '' : 'disabled'}>🗑 Elimina</button>
      <button type="button" class="btn sm" data-b="done">Fine</button></div>` : ''}`;

  const box = main.querySelector('.tabs-container');
  const more = main.querySelector('.load-more');

  if (!all.length) {
    box.classList.remove('grid', 'list');
    if (!total) {
      box.innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">🎸</div><h2>L'archivio è vuoto</h2>
        <p class="muted">Aggiungi la prima tablatura: trascina un'immagine o un PDF nella finestra, incollala con <kbd>Ctrl</kbd>+<kbd>V</kbd> oppure scegli un file.</p>
        <button type="button" class="btn primary lg" data-a="new">＋ Nuova tablatura</button></div>`;
    } else {
      box.innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">🔍</div><h2>Nessuna tablatura trovata</h2>
        <p class="muted">${view.scope === 'all' && !view.query.trim() && !nFilters ? '' : 'Prova a cambiare ricerca, filtri o categoria.'}</p>
        ${(view.query.trim() || nFilters) ? '<button type="button" class="btn" data-f="clear-all">Rimuovi ricerca e filtri</button>' : ''}</div>`;
    }
  } else {
    let drawn = 0;
    const drawMore = () => {
      const upto = Math.min(all.length, view.limit);
      const frag = document.createDocumentFragment();
      for (let i = drawn; i < upto; i++) {
        const el = html(itemHTML(all[i], mode, manual, i > 0, i < all.length - 1));
        frag.appendChild(el);
      }
      box.appendChild(frag);
      drawn = upto;
      box.querySelectorAll('img.thumb:not([src]):not([data-obs])').forEach((img) => {
        img.dataset.obs = '1';
        if (IO_THUMBS) IO_THUMBS.observe(img); else loadThumb(img);
      });
      if (drawn < all.length) {
        more.hidden = false;
        more.innerHTML = `<button type="button" class="btn">Mostra altre (${all.length - drawn})</button>`;
        more.querySelector('button').onclick = () => { view.limit += PAGE_SIZE * 2; drawMore(); };
        if (IO_MORE) { IO_MORE.disconnect(); IO_MORE.observe(more); IO_MORE_CB = () => { view.limit += PAGE_SIZE * 2; drawMore(); }; }
      } else { more.hidden = true; if (IO_MORE) IO_MORE.disconnect(); }
    };
    drawMore();
  }

  bindArchive(main, box, ids, mode);
  if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
}

/** Caricamento automatico scorrendo in fondo all'elenco. */
let IO_MORE_CB = null;
const IO_MORE = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting) && IO_MORE_CB) IO_MORE_CB(); }, { rootMargin: '400px' })
  : null;

/* ================================================================ EVENTI */

function bindArchive(main, box, ids, mode) {
  const redraw = () => S.emitChange('view');
  const newForm = () => openTabForm({ presetCategoryId: view.scope === 'category' ? view.categoryId : null });

  main.querySelector('.sort-select').onchange = (e) => guard(() => S.setSetting('sortBy', e.target.value).then(redraw));
  main.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => guard(() => S.setSetting('viewMode', b.dataset.mode).then(redraw)); });
  main.querySelector('[data-a=filters]').onclick = () => { view.filtersOpen = !view.filtersOpen; redraw(); };
  main.querySelector('[data-a=select]').onclick = () => { view.selecting = !view.selecting; if (!view.selecting) view.selected.clear(); redraw(); };
  main.querySelectorAll('.crumb').forEach((b) => { b.onclick = () => { location.hash = `#/categoria/${b.dataset.cat}`; }; });
  main.querySelectorAll('[data-a=new]').forEach((b) => { b.onclick = newForm; });

  // Filtri
  const fp = main.querySelector('#filters-panel');
  if (fp) {
    fp.querySelector('[data-f=fav]').onchange = (e) => { view.onlyFav = e.target.checked; view.limit = PAGE_SIZE; redraw(); };
    for (const key of ['caged', 'keys']) {
      fp.querySelector(`[data-f=${key}]`).onclick = (e) => {
        const b = e.target.closest('.chip'); if (!b) return;
        const v = b.dataset.v;
        view[key] = view[key].includes(v) ? view[key].filter((x) => x !== v) : [...view[key], v];
        view.limit = PAGE_SIZE; redraw();
      };
    }
    fp.querySelector('[data-f=reset]').onclick = () => { view.caged = []; view.keys = []; view.onlyFav = false; view.limit = PAGE_SIZE; redraw(); };
  }
  main.querySelectorAll('[data-f=clear-all]').forEach((b) => {
    b.onclick = () => {
      Object.assign(view, { query: '', caged: [], keys: [], onlyFav: false, limit: PAGE_SIZE });
      const si = document.getElementById('search-input'); if (si) si.value = '';
      redraw();
    };
  });

  // Barra azioni di gruppo
  const bar = main.querySelector('.bulk-bar');
  if (bar) {
    bar.onclick = (e) => {
      const b = e.target.closest('[data-b]'); if (!b) return;
      const a = b.dataset.b;
      if (a === 'all') { ids.forEach((id) => view.selected.add(id)); redraw(); }
      else if (a === 'none') { view.selected.clear(); redraw(); }
      else if (a === 'done') { view.selecting = false; view.selected.clear(); redraw(); }
      else if (a === 'edit') openBulkEdit([...view.selected]);
      else if (a === 'del') deleteWithUndo([...view.selected]);
    };
  }

  // Azioni sulle singole tablature (delegazione)
  box.onclick = (e) => {
    const item = e.target.closest('[data-id]'); if (!item) return;
    const act = e.target.closest('[data-act]'); if (!act) return;
    const id = item.dataset.id;
    const a = act.dataset.act;
    if (a === 'open') {
      if (view.selecting) { toggleSel(id, item); return; }
      openViewer(ids, Math.max(0, ids.indexOf(id)));
    } else if (a === 'sel') toggleSel(id, item, act.checked);
    else if (a === 'fav') guard(() => S.updateTab(id, { favorite: !S.state.tabs.get(id).favorite }));
    else if (a === 'edit') openTabForm({ id });
    else if (a === 'dup') guard(async () => { await S.duplicateTab(id); toast('Tablatura duplicata.', { type: 'success' }); });
    else if (a === 'del') deleteWithUndo([id]);
    else if (a === 'up') guard(() => S.moveInOrder(ids, id, -1));
    else if (a === 'down') guard(() => S.moveInOrder(ids, id, 1));
  };
  void mode;
}

/** Aggiorna la selezione senza ridisegnare tutto l'elenco. */
function toggleSel(id, item, forced) {
  const on = forced === undefined ? !view.selected.has(id) : forced;
  if (on) view.selected.add(id); else view.selected.delete(id);
  item.classList.toggle('selected', on);
  const cb = item.querySelector('.sel-box'); if (cb) cb.checked = on;
  const n = view.selected.size;
  const bar = document.querySelector('.bulk-bar');
  if (bar) {
    bar.querySelector('.bulk-count').textContent = `${n} selezionat${n === 1 ? 'a' : 'e'}`;
    bar.querySelectorAll('[data-b=edit],[data-b=del]').forEach((b) => { b.disabled = !n; });
  }
}
