/**
 * bulk.js — Azioni su più documenti insieme (aggiungi/rimuovi tag, stato, cestino).
 */
import { STATUSES } from './config.js';
import { state, activeTagIds } from './store.js';
import { addTags, removeTags, updateDocuments, trashDocuments, restoreDocuments } from './actions.js';
import { esc, h } from './util.js';
import { openDialog, confirmDialog, toast, toastError } from './ui.js';
import { createTagPicker, tagChipHtml, sortedActiveTags } from './tagpicker.js';

const n = (k) => (k === 1 ? '1 documento' : `${k} documenti`);

export async function bulkAddTags(ids) {
  const picker = createTagPicker({ placeholder: 'Scrivi per cercare o creare un tag…' });
  const body = h(`<div class="stack"><p>Tag da aggiungere a ${n(ids.length)}:</p></div>`);
  body.appendChild(picker.el);
  const d = openDialog({
    title: 'Aggiungi tag', body,
    actions: [
      { label: 'Annulla', value: null },
      { label: 'Aggiungi', kind: 'primary', onClick: async () => {
        if (!picker.value.length) { picker.focus(); return false; }
        try { await addTags(ids, picker.value); toast(`Tag aggiunti a ${n(ids.length)}.`, { type: 'ok' }); return true; }
        catch (e) { toastError(e); return false; }
      } },
    ],
  });
  setTimeout(() => picker.focus(), 30);
  return d.result;
}

export async function bulkRemoveTags(ids) {
  const act = activeTagIds();
  const present = new Set();
  ids.forEach((id) => state.docTags.get(id)?.forEach((t) => { if (act.has(t)) present.add(t); }));
  if (!present.size) { toast('I documenti selezionati non hanno tag da togliere.'); return null; }
  const chosen = new Set();
  const body = h(`<div class="stack"><p>Tocca i tag da togliere da ${n(ids.length)}:</p>
    <div class="chips pick">${sortedActiveTags().filter((t) => present.has(t.id))
      .map((t) => tagChipHtml(t, { withCategory: true })).join('')}</div></div>`);
  body.querySelector('.pick').addEventListener('click', (e) => {
    const c = e.target.closest('[data-tag]');
    if (!c) return;
    const id = c.dataset.tag;
    if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
    c.classList.toggle('picked', chosen.has(id));
  });
  const d = openDialog({
    title: 'Rimuovi tag', body,
    actions: [
      { label: 'Annulla', value: null },
      { label: 'Rimuovi', kind: 'danger', onClick: async () => {
        if (!chosen.size) return false;
        try { await removeTags(ids, [...chosen]); toast('Tag rimossi.', { type: 'ok' }); return true; }
        catch (e) { toastError(e); return false; }
      } },
    ],
  });
  return d.result;
}

export async function bulkStatus(ids) {
  const body = h(`<div class="stack"><p>Nuovo stato per ${n(ids.length)}:</p>
    <div class="row-actions">${STATUSES.map((s) => `<button type="button" class="btn big" data-s="${s.id}">${esc(s.label)}</button>`).join('')}</div></div>`);
  const d = openDialog({ title: 'Cambia stato', body, actions: [{ label: 'Annulla', value: null }] });
  body.querySelectorAll('[data-s]').forEach((b) => {
    b.onclick = async () => {
      try { await updateDocuments(ids, { status: b.dataset.s }); toast('Stato aggiornato.', { type: 'ok' }); d.close(true); }
      catch (e) { toastError(e); }
    };
  });
  return d.result;
}

export async function bulkTrash(ids) {
  const ok = await confirmDialog(`Spostare ${n(ids.length)} nel cestino? Potrai ripristinarli dal Cestino.`,
    { title: 'Sposta nel cestino', ok: 'Sposta nel cestino', danger: true });
  if (!ok) return false;
  try {
    await trashDocuments(ids);
    toast(`${n(ids.length)} nel cestino.`, { type: 'ok', action: { label: 'Annulla', onClick: () => restoreDocuments(ids).catch(toastError) } });
    return true;
  } catch (e) { toastError(e); return false; }
}
