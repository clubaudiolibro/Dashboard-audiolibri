/**
 * filter.js — Logica dei filtri e pannello dei filtri (usato da Libreria e Visualizza).
 *
 * Regole:
 *  - tag inclusi: OR dentro la stessa categoria, AND tra categorie diverse;
 *  - un documento con almeno un tag escluso viene scartato;
 *  - i documenti senza tag compaiono solo se nessun filtro tag è attivo;
 *  - stato (scelta multipla), voto minimo, ricerca su titolo/artista/note/nome file.
 */
import { STATUSES } from './config.js';
import { state, activeCategories, activeTags, activeTagIds, activeDocuments, docActiveTagIds } from './store.js';
import { esc, h, norm, debounce } from './util.js';
import { DEFAULT_TAG_COLOR } from './tagpicker.js';

export const SORTS = [
  { id: 'title', label: 'Titolo A-Z' },
  { id: 'newest', label: 'Più recenti' },
  { id: 'oldest', label: 'Meno recenti' },
  { id: 'random', label: 'Casuale' },
];

export function emptyFilter() {
  return { include: [], exclude: [], status: [], minMastery: 0, sort: 'title', seed: 1, query: '' };
}

/** Copia "pulita" di un filtro (anche da una raccolta salvata), senza tag che non esistono più. */
export function normalizeFilter(f = {}) {
  const ids = new Set(state.tags.map((t) => t.id));
  const base = emptyFilter();
  return {
    include: (f.include || []).filter((id) => ids.has(id)),
    exclude: (f.exclude || []).filter((id) => ids.has(id)),
    status: (f.status || []).filter((s) => STATUSES.some((x) => x.id === s)),
    minMastery: Math.max(0, Math.min(5, Number(f.minMastery) || 0)),
    sort: SORTS.some((s) => s.id === f.sort) ? f.sort : base.sort,
    seed: Number(f.seed) || base.seed,
    query: typeof f.query === 'string' ? f.query : '',
  };
}

/** Parte del filtro che si salva in una raccolta. */
export function filterForCollection(f) {
  return { include: f.include, exclude: f.exclude, status: f.status, minMastery: f.minMastery, sort: f.sort };
}

/** Numero di filtri attivi (per il badge del pannello). */
export function activeFilterCount(f) {
  const act = activeTagIds();
  return f.include.filter((id) => act.has(id)).length + f.exclude.filter((id) => act.has(id)).length
    + (f.status.length ? 1 : 0) + (f.minMastery ? 1 : 0);
}

export function docTitle(d) {
  return (d.title && d.title.trim()) || d.original_name || 'Senza titolo';
}

/** Numero pseudo-casuale stabile per (seme, id): l'ordine casuale non cambia finché non si rimischia. */
function hashRank(seed, id) {
  let x = seed >>> 0;
  for (let i = 0; i < id.length; i++) { x = Math.imul(x ^ id.charCodeAt(i), 2654435761) >>> 0; x ^= x >>> 13; }
  return x;
}

/**
 * Applica il filtro. docs: elenco di partenza (default: documenti non eliminati).
 * Restituisce l'array filtrato e ordinato.
 */
export function applyFilter(f, docs = activeDocuments()) {
  const act = activeTagIds();
  const tagCat = new Map(activeTags().map((t) => [t.id, t.category_id]));
  const includeByCat = new Map();
  f.include.filter((id) => act.has(id)).forEach((id) => {
    const c = tagCat.get(id);
    if (!includeByCat.has(c)) includeByCat.set(c, new Set());
    includeByCat.get(c).add(id);
  });
  const exclude = new Set(f.exclude.filter((id) => act.has(id)));
  const tagFilterOn = includeByCat.size > 0 || exclude.size > 0;
  const status = new Set(f.status);
  const q = norm(f.query).trim();
  const words = q ? q.split(/\s+/) : [];

  const out = docs.filter((d) => {
    const tags = docActiveTagIds(d.id, act);
    if (tagFilterOn && tags.length === 0) return false;
    if (exclude.size && tags.some((t) => exclude.has(t))) return false;
    for (const set of includeByCat.values()) {
      if (!tags.some((t) => set.has(t))) return false;
    }
    if (status.size && !status.has(d.status)) return false;
    if (f.minMastery && (Number(d.mastery) || 0) < f.minMastery) return false;
    if (words.length) {
      const hay = norm(`${d.title || ''} ${d.artist || ''} ${d.notes || ''} ${d.original_name || ''}`);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  return sortDocs(out, f.sort, f.seed);
}

export function sortDocs(list, sort, seed = 1) {
  const coll = new Intl.Collator('it', { sensitivity: 'base', numeric: true });
  const arr = [...list];
  if (sort === 'newest') arr.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  else if (sort === 'oldest') arr.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  else if (sort === 'random') arr.sort((a, b) => hashRank(seed, a.id) - hashRank(seed, b.id));
  else arr.sort((a, b) => coll.compare(docTitle(a), docTitle(b)));
  return arr;
}

/* ================================================================ PANNELLO */

/**
 * Crea il pannello dei filtri.
 * opts: { filter, onChange(filter), compact: bool (tablet = chip grandi), showSearch, showSort }
 * Restituisce { el, setFilter(f), refresh() }.
 */
export function createFilterPanel({ filter, onChange, showSearch = true, showSort = true, big = false }) {
  let f = normalizeFilter(filter);
  const el = h(`<div class="filter-panel ${big ? 'big' : ''}">
    <div class="fp-top">
      ${showSearch ? '<input type="search" class="fp-search" placeholder="Cerca titolo, artista, note, nome file…" aria-label="Cerca">' : ''}
      ${showSort ? `<label class="fp-sort"><span class="sr-only">Ordina</span><select aria-label="Ordinamento">${SORTS.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}</select></label>
        <button type="button" class="btn fp-shuffle" title="Mischia di nuovo">🔀 Mischia</button>` : ''}
      <button type="button" class="btn fp-toggle" aria-expanded="true">Filtri <span class="badge zero fp-count">0</span></button>
    </div>
    <div class="fp-body">
      <div class="fp-cats"></div>
      <div class="fp-group">
        <div class="fp-label">Stato</div>
        <div class="fp-chips fp-status">${STATUSES.map((s) => `<button type="button" class="chip" data-status="${s.id}" aria-pressed="false">${s.label}</button>`).join('')}</div>
      </div>
      <div class="fp-group">
        <div class="fp-label">Voto minimo</div>
        <div class="fp-chips fp-mastery">
          <button type="button" class="chip" data-min="0" aria-pressed="false">Tutti</button>
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="chip" data-min="${n}" aria-pressed="false">${'★'.repeat(n)}</button>`).join('')}
        </div>
      </div>
      <div class="fp-foot">
        <span class="muted small">Tocca un tag: 1 volta = includi, 2 volte = escludi, 3 volte = neutro.</span>
        <button type="button" class="btn ghost fp-reset">Azzera filtri</button>
      </div>
    </div>
  </div>`);

  const search = el.querySelector('.fp-search');
  const sortSel = el.querySelector('.fp-sort select');
  const shuffle = el.querySelector('.fp-shuffle');
  const body = el.querySelector('.fp-body');
  const toggle = el.querySelector('.fp-toggle');
  const prefKey = `tabshelf.filterOpen.${big ? 'view' : 'lib'}`;
  const setOpen = (open) => {
    body.hidden = !open; toggle.setAttribute('aria-expanded', String(open));
    localStorage.setItem(prefKey, open ? '1' : '0');
  };
  setOpen(localStorage.getItem(prefKey) !== '0');
  toggle.onclick = () => setOpen(body.hidden);

  const fire = () => { renderState(); onChange({ ...f }); };

  const renderCats = () => {
    const tags = activeTags();
    const cats = activeCategories().filter((c) => tags.some((t) => t.category_id === c.id));
    const wrap = el.querySelector('.fp-cats');
    if (!cats.length) { wrap.innerHTML = '<p class="muted small">Nessun tag ancora: creali nella pagina Tag.</p>'; return; }
    wrap.innerHTML = cats.map((c) => `<div class="fp-group">
      <div class="fp-label">${esc(c.name)}</div>
      <div class="fp-chips">${tags.filter((t) => t.category_id === c.id).sort((a, b) => a.name.localeCompare(b.name, 'it'))
        .map((t) => `<button type="button" class="chip tag" data-tag="${esc(t.id)}" style="--c:${esc(t.color || DEFAULT_TAG_COLOR)}">${esc(t.name)}</button>`).join('')}</div>
    </div>`).join('');
  };

  const renderState = () => {
    el.querySelectorAll('.chip[data-tag]').forEach((b) => {
      const id = b.dataset.tag;
      const st = f.include.includes(id) ? 'in' : f.exclude.includes(id) ? 'out' : '';
      b.dataset.state = st;
      b.setAttribute('aria-label', `${b.textContent}: ${st === 'in' ? 'incluso' : st === 'out' ? 'escluso' : 'neutro'}`);
    });
    el.querySelectorAll('.chip[data-status]').forEach((b) => b.setAttribute('aria-pressed', String(f.status.includes(b.dataset.status))));
    el.querySelectorAll('.chip[data-min]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.min === f.minMastery)));
    if (search && document.activeElement !== search) search.value = f.query;
    if (sortSel) sortSel.value = f.sort;
    if (shuffle) shuffle.hidden = f.sort !== 'random';
    const n = activeFilterCount(f);
    const badge = el.querySelector('.fp-count');
    badge.textContent = String(n); badge.classList.toggle('zero', n === 0);
  };

  el.addEventListener('click', (e) => {
    const t = e.target.closest('.chip[data-tag]');
    if (t) {
      const id = t.dataset.tag;
      if (f.include.includes(id)) { f.include = f.include.filter((x) => x !== id); f.exclude = [...f.exclude, id]; }
      else if (f.exclude.includes(id)) { f.exclude = f.exclude.filter((x) => x !== id); }
      else f.include = [...f.include, id];
      fire(); return;
    }
    const s = e.target.closest('.chip[data-status]');
    if (s) {
      const id = s.dataset.status;
      f.status = f.status.includes(id) ? f.status.filter((x) => x !== id) : [...f.status, id];
      fire(); return;
    }
    const m = e.target.closest('.chip[data-min]');
    if (m) { f.minMastery = +m.dataset.min; fire(); }
  });
  el.querySelector('.fp-reset').onclick = () => {
    f = { ...emptyFilter(), sort: f.sort, seed: f.seed, query: f.query };
    fire();
  };
  if (search) search.addEventListener('input', debounce(() => { f.query = search.value; fire(); }, 150));
  if (sortSel) sortSel.onchange = () => { f.sort = sortSel.value; if (f.sort === 'random') f.seed = Math.floor(Math.random() * 1e9); fire(); };
  if (shuffle) shuffle.onclick = () => { f.seed = Math.floor(Math.random() * 1e9); fire(); };

  renderCats(); renderState();
  return {
    el,
    setFilter(nf) { f = normalizeFilter(nf); renderState(); },
    refresh() { renderCats(); renderState(); },
    get filter() { return { ...f }; },
  };
}
