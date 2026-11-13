/**
 * Cestino unico per documenti, tag e categorie (nessuna cancellazione automatica).
 */
import { SPACE } from '../config.js';
import { state, onChange, spaceUsage } from '../store.js';
import {
  restoreDocuments, purgeDocuments, restoreTag, purgeTag, restoreCategory, purgeCategory, emptyTrash,
} from '../actions.js';
import { thumbUrl } from '../storage.js';
import { esc, h, formatBytes, formatDate } from '../util.js';
import { confirmDialog, toast, toastError } from '../ui.js';
import { DEFAULT_TAG_COLOR, categoryById } from '../tagpicker.js';
import { docTitle } from '../filter.js';

export function spaceSummaryHtml() {
  const sp = spaceUsage();
  const pct = Math.min(100, (sp.total / SPACE.quotaBytes) * 100);
  const warn = sp.total > SPACE.quotaBytes * SPACE.quotaWarnRatio;
  return `<div class="space ${warn ? 'warn' : ''}">
    <div class="space-text"><strong>Spazio usato:</strong> ${formatBytes(sp.total)} di ${formatBytes(SPACE.quotaBytes)}
      (${pct.toFixed(1).replace('.', ',')}%) · <strong>nel cestino:</strong> ${formatBytes(sp.trash)}</div>
    <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct.toFixed(0)}" aria-label="Spazio usato">
      <div class="meter-bar" style="width:${pct}%"></div></div>
  </div>`;
}

export function renderTrash(el) {
  const page = h(`<section class="page narrow-wide">
    <div class="page-head">
      <h1>Cestino</h1>
      <span class="spacer"></span>
      <button type="button" class="btn danger" data-act="empty">Svuota tutto</button>
    </div>
    <div class="panel slot-space"></div>
    <p class="muted">Gli elementi restano qui finché non li elimini tu: nessuna cancellazione automatica.</p>
    <div class="slot-lists"></div>
  </section>`);
  el.appendChild(page);
  const lists = page.querySelector('.slot-lists');

  const render = () => {
    page.querySelector('.slot-space').innerHTML = spaceSummaryHtml();
    const tdocs = state.documents.filter((d) => d.deleted_at).sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)));
    const ttags = state.tags.filter((t) => t.deleted_at);
    const tcats = state.categories.filter((c) => c.deleted_at);
    page.querySelector('[data-act=empty]').disabled = !(tdocs.length + ttags.length + tcats.length);
    if (!tdocs.length && !ttags.length && !tcats.length) {
      lists.innerHTML = '<div class="panel empty"><p>Il cestino è vuoto.</p></div>';
      return;
    }
    const row = (kind, id, inner) => `<li class="trash-row" data-kind="${kind}" data-id="${esc(id)}">${inner}
      <span class="spacer"></span>
      <button type="button" class="btn" data-act="restore">Ripristina</button>
      <button type="button" class="btn danger-outline" data-act="purge">Elimina definitivamente</button></li>`;
    lists.innerHTML = `
      ${tdocs.length ? `<div class="panel"><h2>Documenti (${tdocs.length})</h2><ul class="trash-list">
        ${tdocs.map((d) => row('doc', d.id, `<span class="tthumb"><img alt="" data-path="${esc(d.thumb_path || '')}"></span>
          <span class="tinfo"><strong>${esc(docTitle(d))}</strong>
          <span class="muted small">${d.artist ? `${esc(d.artist)} · ` : ''}${formatBytes((+d.file_size || 0) + (+d.thumb_size || 0))} · eliminato il ${formatDate(d.deleted_at)}</span></span>`)).join('')}
      </ul></div>` : ''}
      ${ttags.length ? `<div class="panel"><h2>Tag (${ttags.length})</h2><ul class="trash-list">
        ${ttags.map((t) => {
          const cat = categoryById(t.category_id);
          return row('tag', t.id, `<span class="tag-chip" style="--c:${esc(t.color || DEFAULT_TAG_COLOR)}">${esc(t.name)}</span>
            <span class="muted small">${esc(cat?.name || '')}${cat?.deleted_at ? ' (categoria anch\'essa nel cestino)' : ''} · eliminato il ${formatDate(t.deleted_at)}</span>`);
        }).join('')}
      </ul></div>` : ''}
      ${tcats.length ? `<div class="panel"><h2>Categorie (${tcats.length})</h2><ul class="trash-list">
        ${tcats.map((c) => row('cat', c.id, `<strong>${esc(c.name)}</strong>
          <span class="muted small">${state.tags.filter((t) => t.category_id === c.id).length} tag · eliminata il ${formatDate(c.deleted_at)}</span>`)).join('')}
      </ul></div>` : ''}`;
    lists.querySelectorAll('img[data-path]').forEach((img) => {
      if (img.dataset.path) thumbUrl(img.dataset.path).then((u) => { if (u) img.src = u; }).catch(() => {});
    });
  };

  lists.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    const li = e.target.closest('.trash-row');
    if (!btn || !li) return;
    const { kind, id } = li.dataset;
    const act = btn.dataset.act;
    btn.disabled = true;
    try {
      if (act === 'restore') {
        if (kind === 'doc') await restoreDocuments([id]);
        if (kind === 'tag') {
          await restoreTag(id);
          const t = state.tags.find((x) => x.id === id);
          if (categoryById(t?.category_id)?.deleted_at) toast('Tag ripristinato, ma resta nascosto finché non ripristini anche la sua categoria.', { type: 'warn' });
        }
        if (kind === 'cat') await restoreCategory(id);
        toast('Ripristinato.', { type: 'ok' });
      } else {
        const what = kind === 'doc' ? 'il documento (e i suoi file)' : kind === 'tag' ? 'il tag (e le sue associazioni ai documenti)' : 'la categoria con tutti i suoi tag e le loro associazioni';
        const ok = await confirmDialog(`Eliminare definitivamente ${what}? L'operazione non si può annullare.`,
          { title: 'Elimina definitivamente', ok: 'Elimina', danger: true });
        if (!ok) { btn.disabled = false; return; }
        if (kind === 'doc') await purgeDocuments([id]);
        if (kind === 'tag') await purgeTag(id);
        if (kind === 'cat') await purgeCategory(id);
        toast('Eliminato definitivamente.', { type: 'ok' });
      }
    } catch (err) { toastError(err); btn.disabled = false; }
  });

  page.querySelector('[data-act=empty]').onclick = async (e) => {
    const nd = state.documents.filter((d) => d.deleted_at).length;
    const nt = state.tags.filter((t) => t.deleted_at).length;
    const nc = state.categories.filter((c) => c.deleted_at).length;
    const ok = await confirmDialog(`Eliminare definitivamente tutto il contenuto del cestino?<br><br>
      ${nd} documenti (con i loro file), ${nt} tag e ${nc} categorie. L'operazione non si può annullare.`,
    { title: 'Svuota il cestino', ok: 'Svuota tutto', danger: true });
    if (!ok) return;
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Eliminazione…';
    try { await emptyTrash(); toast('Cestino svuotato.', { type: 'ok' }); }
    catch (err) { toastError(err); }
    finally { b.textContent = 'Svuota tutto'; }
  };

  const off = onChange(render);
  render();
  return off;
}
