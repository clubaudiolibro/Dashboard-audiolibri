/**
 * Gestione di categorie e tag.
 */
import { TAG_PALETTE } from '../config.js';
import { state, onChange, activeCategories, activeTags, compareTags } from '../store.js';
import {
  createCategory, updateCategory, reorderCategories, trashCategory, restoreCategory,
  createTag, updateTag, reorderTags, trashTag, restoreTag, mergeTags, tagUsage, categoryUsage,
} from '../actions.js';
import { esc, h } from '../util.js';
import { openDialog, confirmDialog, promptDialog, toast, toastError } from '../ui.js';
import { DEFAULT_TAG_COLOR, categoryById, sortedActiveTags } from '../tagpicker.js';

const docs = (n) => (n === 1 ? '1 documento' : `${n} documenti`);

export function renderTags(el) {
  const page = h(`<section class="page narrow-wide">
    <div class="page-head">
      <h1>Tag</h1>
      <span class="muted count"></span>
      <button type="button" class="btn primary" data-act="newcat">＋ Nuova categoria</button>
    </div>
    <p class="muted">Organizza i tag in categorie (per esempio Genere, Tecnica, Tonalità, CAGED…).
      Un documento può avere più tag della stessa categoria. Puoi creare i tag qui oppure al volo
      mentre carichi o modifichi un documento.</p>
    <div class="cat-list"></div>
  </section>`);
  el.appendChild(page);
  const list = page.querySelector('.cat-list');
  let ordering = null; // id della categoria in modalità "ordina tag"

  const render = () => {
    const cats = activeCategories();
    const tags = activeTags();
    page.querySelector('.count').textContent = `${cats.length} categori${cats.length === 1 ? 'a' : 'e'} · ${tags.length} tag`;
    if (!cats.length) {
      list.innerHTML = '<div class="panel empty"><p>Nessuna categoria. Crea la prima con «Nuova categoria».</p></div>';
      return;
    }
    list.innerHTML = cats.map((c, i) => {
      const ct = tags.filter((t) => t.category_id === c.id).sort(compareTags);
      const ord = ordering === c.id;
      return `<div class="panel cat" data-cat="${esc(c.id)}">
        <div class="cat-head">
          <h2>${esc(c.name)}</h2>
          <span class="muted small">${ct.length} tag</span>
          <span class="spacer"></span>
          <button type="button" class="icon-btn" data-act="up" title="Sposta su" aria-label="Sposta su" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="icon-btn" data-act="down" title="Sposta giù" aria-label="Sposta giù" ${i === cats.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="btn ${ord ? 'primary' : ''}" data-act="ordertags" ${ct.length < 2 ? 'disabled' : ''}>${ord ? 'Fine' : 'Ordina tag'}</button>
          <button type="button" class="btn" data-act="renamecat">Rinomina</button>
          <button type="button" class="btn danger-outline" data-act="delcat">Elimina</button>
        </div>
        ${ord ? `<p class="muted small">Usa le frecce per spostare i tag: questo ordine vale in tutta l'app (filtri, schede, suggerimenti).
          <button type="button" class="linklike" data-act="sortaz">Metti in ordine alfabetico</button></p>` : ''}
        <div class="tag-rows ${ord ? 'ordering' : ''}">
          ${ct.map((t, k) => (ord
    ? `<span class="tag-row" data-order="${esc(t.id)}">
              <button type="button" class="icon-btn" data-move="-1" aria-label="Sposta ${esc(t.name)} prima" ${k === 0 ? 'disabled' : ''}>←</button>
              <span class="dot" style="background:${esc(t.color || DEFAULT_TAG_COLOR)}"></span>
              <span class="name">${esc(t.name)}</span>
              <button type="button" class="icon-btn" data-move="1" aria-label="Sposta ${esc(t.name)} dopo" ${k === ct.length - 1 ? 'disabled' : ''}>→</button>
            </span>`
    : `<button type="button" class="tag-row" data-tag="${esc(t.id)}" title="Modifica il tag">
              <span class="dot" style="background:${esc(t.color || DEFAULT_TAG_COLOR)}"></span>
              <span class="name">${esc(t.name)}</span>
              <span class="muted small">${tagUsage(t.id)}</span>
            </button>`)).join('')}
        </div>
        <form class="new-tag" autocomplete="off">
          <input type="text" placeholder="Nuovo tag in «${esc(c.name)}»…" aria-label="Nuovo tag in ${esc(c.name)}">
          <button type="submit" class="btn">Aggiungi</button>
        </form>
      </div>`;
    }).join('');
  };

  page.querySelector('[data-act=newcat]').onclick = async () => {
    const name = await promptDialog('Nome della categoria', { title: 'Nuova categoria', ok: 'Crea', placeholder: 'es. Genere' });
    if (!name) return;
    try { await createCategory(name); toast('Categoria creata.', { type: 'ok' }); } catch (e) { toastError(e); }
  };

  list.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target.closest('.new-tag');
    const catId = form.closest('[data-cat]').dataset.cat;
    const input = form.querySelector('input');
    const name = input.value.trim();
    if (!name) return;
    try {
      await createTag(catId, name);
      // dopo il ridisegno rimettiamo il cursore nello stesso campo
      list.querySelector(`[data-cat="${CSS.escape(catId)}"] .new-tag input`)?.focus();
    } catch (err) { toastError(err); }
  });

  list.addEventListener('click', async (e) => {
    const catEl = e.target.closest('[data-cat]');
    if (!catEl) return;
    const catId = catEl.dataset.cat;
    const cat = categoryById(catId);
    const tagBtn = e.target.closest('[data-tag]');
    if (tagBtn) { editTagDialog(tagBtn.dataset.tag); return; }
    const move = e.target.closest('[data-move]');
    if (move) {
      const ids = activeTags().filter((t) => t.category_id === catId).sort(compareTags).map((t) => t.id);
      const id = move.closest('[data-order]').dataset.order;
      const i = ids.indexOf(id); const j = i + Number(move.dataset.move);
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      try { await reorderTags(ids); } catch (err) { toastError(err); }
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    try {
      if (act === 'up' || act === 'down') {
        const ids = activeCategories().map((c) => c.id);
        const i = ids.indexOf(catId); const j = act === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        await reorderCategories(ids);
      }
      if (act === 'ordertags') { ordering = ordering === catId ? null : catId; render(); return; }
      if (act === 'sortaz') {
        const ids = activeTags().filter((t) => t.category_id === catId)
          .sort((a, b) => a.name.localeCompare(b.name, 'it', { numeric: true })).map((t) => t.id);
        await reorderTags(ids);
        return;
      }
      if (act === 'renamecat') {
        const name = await promptDialog('Nuovo nome', { title: 'Rinomina categoria', value: cat.name });
        if (name && name !== cat.name) await updateCategory(catId, { name });
      }
      if (act === 'delcat') {
        const n = categoryUsage(catId);
        const nt = activeTags().filter((t) => t.category_id === catId).length;
        const ok = await confirmDialog(
          `La categoria <strong>«${esc(cat.name)}»</strong> e i suoi ${nt} tag andranno nel cestino.`
          + (n ? `<br><br>⚠ È usata da <strong>${docs(n)}</strong>: i tag spariranno da questi documenti, ma le associazioni restano conservate e torneranno se ripristini la categoria.` : ''),
          { title: 'Elimina categoria', ok: 'Sposta nel cestino', danger: true });
        if (!ok) return;
        await trashCategory(catId);
        toast('Categoria nel cestino.', { type: 'ok', action: { label: 'Annulla', onClick: () => restoreCategory(catId).catch(toastError) } });
      }
    } catch (err) { toastError(err); }
  });

  const off = onChange(render);
  render();
  return off;
}

/** Finestra di modifica di un tag: nome, colore, unione, eliminazione. */
export function editTagDialog(tagId) {
  const tag = state.tags.find((t) => t.id === tagId);
  if (!tag) return;
  let color = tag.color || DEFAULT_TAG_COLOR;
  const n = tagUsage(tag.id);
  const others = sortedActiveTags().filter((t) => t.id !== tag.id);
  const body = h(`<div class="stack">
    <label class="field"><span>Nome</span><input type="text" name="name" value="${esc(tag.name)}"></label>
    <label class="field"><span>Categoria</span>
      <select name="cat">${activeCategories().map((c) => `<option value="${esc(c.id)}" ${c.id === tag.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    </label>
    <div class="field"><span>Colore</span>
      <div class="palette">
        ${TAG_PALETTE.map((c) => `<button type="button" class="swatch" data-color="${c}" style="background:${c}" aria-label="Colore ${c}"></button>`).join('')}
        <label class="swatch custom" title="Scegli un altro colore"><input type="color" value="${esc(color)}" aria-label="Colore personalizzato"></label>
      </div>
      <div class="preview-chip"></div>
    </div>
    <p class="muted small">Usato da ${docs(n)}.</p>
    <details class="merge">
      <summary>Unisci con un altro tag…</summary>
      <p class="small">Tutti i documenti con «${esc(tag.name)}» riceveranno il tag scelto qui sotto; poi «${esc(tag.name)}» verrà eliminato definitivamente (anche dalle raccolte preferite, dove sarà sostituito).</p>
      <div class="row-actions">
        <select name="target" aria-label="Tag di destinazione">
          <option value="">— scegli il tag di destinazione —</option>
          ${others.map((t) => `<option value="${esc(t.id)}">${esc(categoryById(t.category_id)?.name || '')} › ${esc(t.name)}</option>`).join('')}
        </select>
        <button type="button" class="btn" data-act="merge">Unisci</button>
      </div>
    </details>
  </div>`);
  const preview = body.querySelector('.preview-chip');
  const paint = () => {
    preview.innerHTML = `<span class="tag-chip" style="--c:${esc(color)}">${esc(body.querySelector('[name=name]').value || tag.name)}</span>`;
    body.querySelectorAll('.swatch[data-color]').forEach((s) => s.classList.toggle('on', s.dataset.color.toLowerCase() === color.toLowerCase()));
  };
  body.querySelectorAll('.swatch[data-color]').forEach((s) => { s.onclick = () => { color = s.dataset.color; body.querySelector('input[type=color]').value = color; paint(); }; });
  body.querySelector('input[type=color]').oninput = (e) => { color = e.target.value; paint(); };
  body.querySelector('[name=name]').oninput = paint;
  paint();

  const d = openDialog({
    title: 'Modifica tag', body,
    actions: [
      { label: 'Elimina', kind: 'danger-outline', onClick: async () => {
        const ok = await confirmDialog(`Il tag <strong>«${esc(tag.name)}»</strong> andrà nel cestino.`
          + (n ? `<br><br>⚠ È usato da <strong>${docs(n)}</strong>: sparirà da questi documenti, ma le associazioni restano conservate e torneranno se lo ripristini.` : ''),
        { title: 'Elimina tag', ok: 'Sposta nel cestino', danger: true });
        if (!ok) return false;
        try {
          await trashTag(tag.id);
          toast('Tag nel cestino.', { type: 'ok', action: { label: 'Annulla', onClick: () => restoreTag(tag.id).catch(toastError) } });
          return true;
        } catch (e) { toastError(e); return false; }
      } },
      { label: 'Annulla', value: null },
      { label: 'Salva', kind: 'primary', onClick: async () => {
        try {
          const patch = { name: body.querySelector('[name=name]').value, color };
          const cat = body.querySelector('[name=cat]').value;
          if (cat && cat !== tag.category_id) patch.category_id = cat;
          await updateTag(tag.id, patch);
          return true;
        } catch (e) { toastError(e); return false; }
      } },
    ],
  });

  body.querySelector('[data-act=merge]').onclick = async () => {
    const targetId = body.querySelector('[name=target]').value;
    if (!targetId) { toast('Scegli il tag di destinazione.', { type: 'warn' }); return; }
    const target = state.tags.find((t) => t.id === targetId);
    const ok = await confirmDialog(
      `Unire <strong>«${esc(tag.name)}»</strong> in <strong>«${esc(target.name)}»</strong>?<br><br>`
      + `${docs(n)} riceveranno «${esc(target.name)}» e «${esc(tag.name)}» sarà <strong>eliminato definitivamente</strong>. L'operazione non si può annullare.`,
      { title: 'Unisci tag', ok: 'Unisci', danger: true });
    if (!ok) return;
    try {
      await mergeTags(tag.id, target.id);
      toast(`«${tag.name}» unito in «${target.name}».`, { type: 'ok' });
      d.close(true);
    } catch (e) { toastError(e); }
  };
  return d.result;
}
