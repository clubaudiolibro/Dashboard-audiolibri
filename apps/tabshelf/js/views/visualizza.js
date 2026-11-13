/**
 * Visualizzazione (pensata per il tablet): raccolte preferite, filtri a chip grandi,
 * griglia di miniature e apertura a schermo intero nella sequenza filtrata.
 */
import { state, onChange, activeDocuments } from '../store.js';
import { createCollection, updateCollection, deleteCollection } from '../actions.js';
import { esc, h } from '../util.js';
import { openDialog, confirmDialog, promptDialog, toast, toastError } from '../ui.js';
import { createDocGrid } from '../docgrid.js';
import { createFilterPanel, applyFilter, emptyFilter, normalizeFilter, filterForCollection } from '../filter.js';
import { openViewer } from '../viewer.js';

const KEY = 'tabshelf.viewFilter';

function sameFilter(a, b) {
  const set = (x) => JSON.stringify([...(x || [])].sort());
  return set(a.include) === set(b.include) && set(a.exclude) === set(b.exclude) && set(a.status) === set(b.status)
    && (a.minMastery || 0) === (b.minMastery || 0) && (a.sort || 'title') === (b.sort || 'title');
}

export function renderVisualizza(el) {
  let filter = normalizeFilter(JSON.parse(localStorage.getItem(KEY) || 'null') || emptyFilter());
  let list = [];

  const page = h(`<section class="page view-page">
    <div class="coll-bar" role="toolbar" aria-label="Raccolte preferite">
      <div class="coll-chips"></div>
      <button type="button" class="btn" data-act="save" title="Salva i filtri attuali come raccolta">☆ Salva raccolta</button>
      <button type="button" class="btn" data-act="manage" title="Rinomina o elimina le raccolte">Gestisci</button>
    </div>
    <div class="slot-filter"></div>
    <div class="view-count muted" aria-live="polite"></div>
    <div class="slot-grid"></div>
    <div class="panel empty" hidden></div>
  </section>`);
  el.appendChild(page);

  const grid = createDocGrid({ big: true, showTags: true, onOpen: (doc, i) => openViewer(list, i) });
  page.querySelector('.slot-grid').appendChild(grid.el);

  const panel = createFilterPanel({
    filter, big: true,
    onChange: (f) => { filter = f; save(); refresh(); },
  });
  page.querySelector('.slot-filter').appendChild(panel.el);

  function save() { localStorage.setItem(KEY, JSON.stringify(filter)); }

  function renderCollections() {
    const wrap = page.querySelector('.coll-chips');
    const cols = [...state.collections].sort((a, b) => a.name.localeCompare(b.name, 'it'));
    const allActive = sameFilter(filter, emptyFilter()) && filter.sort === 'title';
    wrap.innerHTML = `<button type="button" class="chip coll ${allActive ? 'on' : ''}" data-coll="">Tutti</button>`
      + cols.map((c) => `<button type="button" class="chip coll ${sameFilter(filter, normalizeFilter(c.filter)) ? 'on' : ''}" data-coll="${esc(c.id)}">${esc(c.name)}</button>`).join('');
    page.querySelector('[data-act=manage]').hidden = cols.length === 0;
  }

  function refresh() {
    const base = activeDocuments();
    list = applyFilter(filter, base);
    page.querySelector('.view-count').textContent = list.length === base.length
      ? `${list.length} document${list.length === 1 ? 'o' : 'i'}` : `${list.length} di ${base.length} documenti`;
    grid.render(list);
    const empty = page.querySelector('.panel.empty');
    empty.hidden = list.length > 0;
    empty.innerHTML = base.length ? '<p>Nessun documento corrisponde ai filtri.</p>'
      : '<p>Non ci sono ancora documenti. Caricali dal PC nella sezione «Carica».</p>';
    renderCollections();
  }

  page.querySelector('.coll-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-coll]'); if (!b) return;
    const c = state.collections.find((x) => x.id === b.dataset.coll);
    filter = c ? { ...normalizeFilter(c.filter), query: '', seed: Math.floor(Math.random() * 1e9) } : emptyFilter();
    panel.setFilter(filter); save(); refresh();
  });

  page.querySelector('[data-act=save]').onclick = async () => {
    const name = await promptDialog('Nome della raccolta', { title: 'Salva raccolta', ok: 'Salva', placeholder: 'es. Blues da ripassare' });
    if (!name) return;
    try { await createCollection(name, filterForCollection(filter)); toast(`Raccolta «${name}» salvata.`, { type: 'ok' }); }
    catch (e) { toastError(e); }
  };

  page.querySelector('[data-act=manage]').onclick = () => manageCollections(() => filter);

  const off = onChange(() => { panel.refresh(); refresh(); });
  refresh();
  return () => { off(); grid.destroy(); };
}

/** Finestra per rinominare, aggiornare o eliminare le raccolte. */
function manageCollections(getFilter) {
  const body = h('<ul class="coll-list"></ul>');
  const render = () => {
    const cols = [...state.collections].sort((a, b) => a.name.localeCompare(b.name, 'it'));
    body.innerHTML = cols.length ? cols.map((c) => `<li data-id="${esc(c.id)}">
      <strong>${esc(c.name)}</strong>
      <span class="spacer"></span>
      <button type="button" class="btn" data-a="rename">Rinomina</button>
      <button type="button" class="btn" data-a="update" title="Sostituisce i filtri salvati con quelli attuali">Usa filtri attuali</button>
      <button type="button" class="btn danger-outline" data-a="delete">Elimina</button>
    </li>`).join('') : '<li class="muted">Nessuna raccolta.</li>';
  };
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    const c = state.collections.find((x) => x.id === id);
    try {
      if (b.dataset.a === 'rename') {
        const name = await promptDialog('Nuovo nome', { title: 'Rinomina raccolta', value: c.name });
        if (name) await updateCollection(id, { name });
      }
      if (b.dataset.a === 'update') {
        await updateCollection(id, { filter: filterForCollection(getFilter()) });
        toast(`Raccolta «${c.name}» aggiornata con i filtri attuali.`, { type: 'ok' });
      }
      if (b.dataset.a === 'delete') {
        if (await confirmDialog(`Eliminare la raccolta «${esc(c.name)}»? I documenti non vengono toccati.`, { title: 'Elimina raccolta', ok: 'Elimina', danger: true })) {
          await deleteCollection(id);
        }
      }
      render();
    } catch (err) { toastError(err); }
  });
  render();
  openDialog({ title: 'Raccolte preferite', body, actions: [{ label: 'Chiudi', value: null }] });
}
