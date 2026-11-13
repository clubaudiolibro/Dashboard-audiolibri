/**
 * docgrid.js — Griglia (o elenco) di documenti con miniature caricate solo quando visibili.
 */
import { STATUSES } from './config.js';
import { docActiveTagIds, activeTagIds } from './store.js';
import { thumbUrl } from './storage.js';
import { esc, h, formatDate } from './util.js';
import { tagById, tagChipHtml, sortedActiveTags } from './tagpicker.js';
import { docTitle } from './filter.js';

const statusLabel = (id) => STATUSES.find((s) => s.id === id)?.label || '';

export function starsText(n) {
  const v = Number(n) || 0;
  return v ? '★'.repeat(v) + '☆'.repeat(5 - v) : '';
}

/**
 * opts: { selectable, layout: 'grid'|'list', big (tablet), showTags, onOpen(doc, index), onSelectionChange(set) }
 */
export function createDocGrid({ selectable = false, layout = 'grid', big = false, showTags = true, onOpen, onSelectionChange } = {}) {
  const el = h(`<div class="doc-grid layout-${layout} ${big ? 'big' : ''}" role="list"></div>`);
  const selected = new Set();
  let docs = [];
  let lastClicked = -1;

  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const img = en.target;
      io.unobserve(img);
      const path = img.dataset.path;
      if (!path) return;
      thumbUrl(path).then((url) => { if (url) { img.src = url; img.classList.add('loaded'); } })
        .catch(() => { img.closest('.thumb')?.classList.add('broken'); });
    });
  }, { rootMargin: '400px 0px' });

  let rank = new Map();
  const cardHtml = (d, i) => {
    const act = activeTagIds();
    const tags = showTags ? docActiveTagIds(d.id, act).map(tagById).filter(Boolean).sort((a, b) => rank.get(a.id) - rank.get(b.id)) : [];
    return `<div class="doc-card ${selected.has(d.id) ? 'selected' : ''}" role="listitem" data-id="${esc(d.id)}" data-i="${i}">
      ${selectable ? `<label class="sel" title="Seleziona"><input type="checkbox" ${selected.has(d.id) ? 'checked' : ''} aria-label="Seleziona ${esc(docTitle(d))}"></label>` : ''}
      <button type="button" class="thumb" aria-label="Apri ${esc(docTitle(d))}">
        <img alt="" data-path="${esc(d.thumb_path || '')}" decoding="async">
        ${d.file_type === 'pdf' ? '<span class="type-badge">PDF</span>' : ''}
      </button>
      <div class="meta">
        <strong class="title">${esc(docTitle(d))}</strong>
        ${d.artist ? `<span class="artist">${esc(d.artist)}</span>` : ''}
        <span class="sub"><span class="status status-${esc(d.status)}">${esc(statusLabel(d.status))}</span>
          ${d.mastery ? `<span class="stars" aria-label="Voto ${d.mastery} su 5">${starsText(d.mastery)}</span>` : ''}
          ${layout === 'list' ? `<span class="muted small">${formatDate(d.created_at)}</span>` : ''}</span>
        ${tags.length ? `<span class="chips">${tags.map((t) => tagChipHtml(t, { extraClass: 'sm' })).join('')}</span>` : ''}
      </div>
    </div>`;
  };

  const render = (list) => {
    docs = list;
    rank = new Map(sortedActiveTags().map((t, k) => [t.id, k]));
    const ids = new Set(list.map((d) => d.id));
    [...selected].forEach((id) => { if (!ids.has(id)) selected.delete(id); });
    io.disconnect();
    el.innerHTML = list.map(cardHtml).join('');
    el.querySelectorAll('img[data-path]').forEach((img) => io.observe(img));
    onSelectionChange?.(selected);
  };

  const toggleSel = (id, on) => {
    if (on) selected.add(id); else selected.delete(id);
    const card = el.querySelector(`.doc-card[data-id="${CSS.escape(id)}"]`);
    if (card) { card.classList.toggle('selected', on); const cb = card.querySelector('input'); if (cb) cb.checked = on; }
  };

  el.addEventListener('click', (e) => {
    const card = e.target.closest('.doc-card');
    if (!card) return;
    const i = +card.dataset.i;
    const id = card.dataset.id;
    if (e.target.closest('.sel')) {
      if (e.target.tagName !== 'INPUT') return; // il clic sulla label arriva anche come clic sull'input
      const on = e.target.checked;
      if (e.shiftKey && lastClicked >= 0) {
        const [a, b] = [Math.min(lastClicked, i), Math.max(lastClicked, i)];
        for (let k = a; k <= b; k++) toggleSel(docs[k].id, on);
      } else toggleSel(id, on);
      lastClicked = i;
      onSelectionChange?.(selected);
      return;
    }
    if (selectable && (e.ctrlKey || e.metaKey)) {
      toggleSel(id, !selected.has(id)); lastClicked = i; onSelectionChange?.(selected); return;
    }
    if (e.target.closest('.thumb, .meta')) onOpen?.(docs[i], i);
  });

  return {
    el,
    render,
    selected,
    get docs() { return docs; },
    selectAll(on = true) { docs.forEach((d) => toggleSel(d.id, on)); onSelectionChange?.(selected); },
    clearSelection() { [...selected].forEach((id) => toggleSel(id, false)); onSelectionChange?.(selected); },
    setLayout(l) { layout = l; el.classList.remove('layout-grid', 'layout-list'); el.classList.add(`layout-${l}`); render(docs); },
    destroy() { io.disconnect(); },
  };
}
