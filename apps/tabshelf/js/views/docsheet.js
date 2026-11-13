/**
 * Scheda documento (finestra): metadati, tag, stato, voto, ruota/ritaglia, cestino.
 */
import { STATUSES, IMAGES } from '../config.js';
import { state, docActiveTagIds } from '../store.js';
import { updateDocument, setDocumentTags, trashDocuments, restoreDocuments } from '../actions.js';
import { thumbUrl, signedUrl, downloadBlob, makePaths, uploadFile, removeFiles, primeThumb } from '../storage.js';
import { esc, h, formatBytes, formatDate } from '../util.js';
import { openDialog, confirmDialog, toast, toastError } from '../ui.js';
import { createTagPicker } from '../tagpicker.js';
import { editImage, encode, resizeCanvas } from '../images.js';
import { docTitle } from '../filter.js';

export function statusSegHtml(current) {
  return `<div class="seg status-seg" role="radiogroup" aria-label="Stato">
    ${STATUSES.map((s) => `<button type="button" class="btn" role="radio" data-status="${s.id}" aria-checked="${s.id === current}">${esc(s.label)}</button>`).join('')}
  </div>`;
}

export function starsInputHtml(value) {
  return `<div class="stars-input" role="radiogroup" aria-label="Voto">
    ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" role="radio" aria-checked="${n === value}" aria-label="${n} stell${n === 1 ? 'a' : 'e'}" class="${n <= (value || 0) ? 'on' : ''}">★</button>`).join('')}
    <button type="button" class="btn ghost small" data-star="0">Nessun voto</button>
  </div>`;
}

export function openDocSheet(docId) {
  const doc = state.documents.find((d) => d.id === docId);
  if (!doc) return;
  let status = doc.status;
  let mastery = doc.mastery || 0;

  const body = h(`<div class="docsheet">
    <div class="ds-preview">
      <div class="ds-thumb"><img alt=""></div>
      <div class="row-actions">
        <button type="button" class="btn" data-act="open">Apri il file</button>
        ${doc.file_type === 'image' ? '<button type="button" class="btn" data-act="edit">Ruota / ritaglia</button>' : ''}
      </div>
      <dl class="facts small">
        <dt>File</dt><dd>${esc(doc.original_name || '—')}</dd>
        <dt>Tipo</dt><dd>${doc.file_type === 'pdf' ? 'PDF' : 'Immagine'}</dd>
        <dt>Dimensione</dt><dd class="ds-size">${formatBytes((+doc.file_size || 0) + (+doc.thumb_size || 0))}</dd>
        <dt>Caricato il</dt><dd>${formatDate(doc.created_at, true)}</dd>
      </dl>
    </div>
    <div class="ds-form stack">
      <label class="field"><span>Titolo</span><input type="text" name="title" value="${esc(doc.title || '')}" placeholder="${esc(doc.original_name || '')}"></label>
      <label class="field"><span>Artista</span><input type="text" name="artist" value="${esc(doc.artist || '')}"></label>
      <div class="field"><span>Tag</span><div class="slot-tags"></div></div>
      <div class="field"><span>Stato</span>${statusSegHtml(status)}</div>
      <div class="field"><span>Voto (padronanza)</span>${starsInputHtml(mastery)}</div>
      <label class="field"><span>Note</span><textarea name="notes" rows="3">${esc(doc.notes || '')}</textarea></label>
    </div>
  </div>`);

  const picker = createTagPicker({ value: docActiveTagIds(doc.id) });
  body.querySelector('.slot-tags').appendChild(picker.el);

  const img = body.querySelector('.ds-thumb img');
  const loadThumb = (path) => thumbUrl(path).then((u) => { if (u) img.src = u; }).catch(() => {});
  loadThumb(doc.thumb_path);

  body.querySelector('.status-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]'); if (!b) return;
    status = b.dataset.status;
    body.querySelectorAll('.status-seg [data-status]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  });
  const starsEl = body.querySelector('.stars-input');
  starsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-star]'); if (!b) return;
    mastery = +b.dataset.star;
    starsEl.querySelectorAll('[data-star]').forEach((x) => {
      const n = +x.dataset.star;
      if (n) { x.classList.toggle('on', n <= mastery); x.setAttribute('aria-checked', String(n === mastery)); }
    });
  });

  body.querySelector('[data-act=open]').onclick = async () => {
    // La finestra va aperta subito (altrimenti il browser la blocca), poi le diamo l'indirizzo.
    const w = window.open('', '_blank');
    try {
      const url = await signedUrl(doc.file_path);
      if (w) { w.opener = null; w.location.href = url; } else location.href = url;
    } catch (e) { w?.close(); toastError(e); }
  };

  const editBtn = body.querySelector('[data-act=edit]');
  if (editBtn) {
    editBtn.onclick = async () => {
      editBtn.disabled = true; editBtn.textContent = 'Apertura…';
      try {
        const blob = await downloadBlob(doc.file_path);
        editBtn.textContent = 'Ruota / ritaglia';
        const canvas = await editImage(blob, `Ruota e ritaglia: ${docTitle(doc)}`);
        if (!canvas) return;
        editBtn.textContent = 'Salvataggio…';
        const file = await encode(canvas, IMAGES.quality);
        const thumb = await encode(resizeCanvas(canvas, IMAGES.thumbSide), IMAGES.thumbQuality);
        const paths = makePaths(doc.id, file.type === 'image/webp' ? 'webp' : 'jpg');
        await uploadFile(paths.file, file);
        await uploadFile(paths.thumb, thumb);
        const old = [doc.file_path, doc.thumb_path];
        await updateDocument(doc.id, { file_path: paths.file, thumb_path: paths.thumb, file_size: file.size, thumb_size: thumb.size });
        await primeThumb(paths.thumb, thumb);
        await removeFiles(old).catch((e) => console.warn('Vecchi file non eliminati', e));
        const fresh = state.documents.find((d) => d.id === doc.id);
        Object.assign(doc, fresh);
        body.querySelector('.ds-size').textContent = formatBytes(file.size + thumb.size);
        loadThumb(paths.thumb);
        toast('Immagine aggiornata.', { type: 'ok' });
      } catch (e) {
        toastError(e, 'Modifica non salvata');
      } finally {
        editBtn.disabled = false; editBtn.textContent = 'Ruota / ritaglia';
      }
    };
  }

  const clean = (v) => { const s = String(v ?? '').trim(); return s || null; };
  const d = openDialog({
    title: docTitle(doc), size: 'lg', body,
    actions: [
      { label: 'Sposta nel cestino', kind: 'danger-outline', onClick: async () => {
        const ok = await confirmDialog(`Spostare «${esc(docTitle(doc))}» nel cestino?`, { title: 'Sposta nel cestino', ok: 'Sposta', danger: true });
        if (!ok) return false;
        try {
          await trashDocuments([doc.id]);
          toast('Documento nel cestino.', { type: 'ok', action: { label: 'Annulla', onClick: () => restoreDocuments([doc.id]).catch(toastError) } });
          return true;
        } catch (e) { toastError(e); return false; }
      } },
      { label: 'Chiudi', value: null },
      { label: 'Salva', kind: 'primary', onClick: async () => {
        const f = body;
        try {
          await updateDocument(doc.id, {
            title: clean(f.querySelector('[name=title]').value),
            artist: clean(f.querySelector('[name=artist]').value),
            notes: clean(f.querySelector('[name=notes]').value),
            status, mastery: mastery || null,
          });
          await setDocumentTags(doc.id, picker.value);
          toast('Modifiche salvate.', { type: 'ok' });
          return true;
        } catch (e) { toastError(e); return false; }
      } },
    ],
  });
  return d.result;
}
