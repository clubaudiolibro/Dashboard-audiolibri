/**
 * Libreria completa e "Da classificare".
 */
import { onChange, activeDocuments, unclassifiedDocuments } from '../store.js';
import { h, debounce } from '../util.js';
import { createDocGrid } from '../docgrid.js';
import { createFilterPanel, applyFilter, emptyFilter, normalizeFilter } from '../filter.js';
import { bulkAddTags, bulkRemoveTags, bulkStatus, bulkTrash } from '../bulk.js';
import { openDocSheet } from './docsheet.js';

const PREF_LAYOUT = 'tabshelf.layout';

export function renderLibrary(el, { mode = 'all' } = {}) {
  const unclassified = mode === 'unclassified';
  let filter = unclassified ? { ...emptyFilter(), sort: 'newest' }
    : normalizeFilter(JSON.parse(sessionStorage.getItem('tabshelf.libFilter') || 'null') || emptyFilter());
  const layout = localStorage.getItem(`${PREF_LAYOUT}.${mode}`) || 'grid';

  const page = h(`<section class="page">
    <div class="page-head">
      <h1>${unclassified ? 'Da classificare' : 'Libreria'}</h1>
      <span class="count muted" aria-live="polite"></span>
      <div class="seg" role="group" aria-label="Vista">
        <button type="button" class="btn" data-layout="grid" aria-pressed="${layout === 'grid'}">Griglia</button>
        <button type="button" class="btn" data-layout="list" aria-pressed="${layout === 'list'}">Elenco</button>
      </div>
    </div>
    ${unclassified ? `<p class="muted">Documenti senza alcun tag attivo. Selezionali e assegna i tag in blocco.</p>
      <div class="filter-panel"><div class="fp-top"><input type="search" class="fp-search" placeholder="Cerca titolo, artista, note, nome file…" aria-label="Cerca"></div></div>` : ''}
    <div class="slot-filter"></div>
    <div class="bulkbar">
      <label class="selall"><input type="checkbox"> <span>Seleziona tutti</span></label>
      <span class="bulk-info muted"></span>
      <span class="bulk-actions" hidden>
        <button type="button" class="btn primary" data-bulk="add">${unclassified ? 'Assegna tag' : 'Aggiungi tag'}</button>
        ${unclassified ? '' : '<button type="button" class="btn" data-bulk="remove">Rimuovi tag</button>'}
        <button type="button" class="btn" data-bulk="status">Cambia stato</button>
        <button type="button" class="btn danger-outline" data-bulk="trash">Sposta nel cestino</button>
      </span>
    </div>
    <div class="slot-grid"></div>
    <div class="panel empty" hidden></div>
  </section>`);
  el.appendChild(page);

  const countEl = page.querySelector('.count');
  const empty = page.querySelector('.panel.empty');
  const selAll = page.querySelector('.selall input');
  const bulkInfo = page.querySelector('.bulk-info');
  const bulkActions = page.querySelector('.bulk-actions');

  const grid = createDocGrid({
    selectable: true, layout,
    onOpen: (doc) => openDocSheet(doc.id),
    onSelectionChange: (sel) => {
      const k = sel.size;
      bulkInfo.textContent = k ? `${k} selezionat${k === 1 ? 'o' : 'i'}` : 'Seleziona più documenti per le azioni in blocco (Maiusc+clic per un intervallo).';
      bulkActions.hidden = k === 0;
      selAll.checked = k > 0 && k === grid.docs.length;
      selAll.indeterminate = k > 0 && k < grid.docs.length;
    },
  });
  page.querySelector('.slot-grid').appendChild(grid.el);

  let panel = null;
  if (!unclassified) {
    panel = createFilterPanel({
      filter,
      onChange: (f) => { filter = f; sessionStorage.setItem('tabshelf.libFilter', JSON.stringify(f)); refresh(); },
    });
    page.querySelector('.slot-filter').appendChild(panel.el);
  } else {
    const s = page.querySelector('.fp-search');
    s.addEventListener('input', debounce(() => { filter.query = s.value; refresh(); }, 150));
  }

  function refresh() {
    const base = unclassified ? unclassifiedDocuments() : activeDocuments();
    const list = applyFilter(filter, base);
    countEl.textContent = list.length === base.length ? `${base.length} document${base.length === 1 ? 'o' : 'i'}`
      : `${list.length} di ${base.length}`;
    grid.render(list);
    empty.hidden = list.length > 0;
    if (!list.length) {
      empty.innerHTML = base.length ? '<p>Nessun documento corrisponde ai filtri.</p>'
        : unclassified ? '<p>🎉 Tutti i documenti hanno almeno un tag.</p>'
          : '<p>La libreria è vuota. <a href="#/carica">Carica le prime tablature</a>.</p>';
    }
  }

  selAll.onchange = () => grid.selectAll(selAll.checked);
  page.querySelectorAll('[data-layout]').forEach((b) => {
    b.onclick = () => {
      localStorage.setItem(`${PREF_LAYOUT}.${mode}`, b.dataset.layout);
      page.querySelectorAll('[data-layout]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      grid.setLayout(b.dataset.layout);
    };
  });
  page.querySelectorAll('[data-bulk]').forEach((b) => {
    b.onclick = async () => {
      const ids = [...grid.selected];
      if (!ids.length) return;
      const act = b.dataset.bulk;
      if (act === 'add') await bulkAddTags(ids);
      if (act === 'remove') await bulkRemoveTags(ids);
      if (act === 'status') await bulkStatus(ids);
      if (act === 'trash') await bulkTrash(ids);
    };
  });

  const off = onChange(() => { panel?.refresh(); refresh(); });
  refresh();
  return () => { off(); grid.destroy(); };
}
