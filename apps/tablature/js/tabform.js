/**
 * tabform.js — Form di inserimento e modifica delle tablature.
 *
 * Flusso rapido: immagine (file / trascina / incolla / fotocamera / PDF) → anteprima
 * con editor facoltativo → categorie e metadati facoltativi → Salva.
 * Supporta una coda di più immagini (es. più file o più pagine PDF) e la
 * conservazione degli ultimi valori per l'inserimento consecutivo.
 */
import * as S from './store.js';
import { CAGED_SHAPES, KEYS, esc, html, errorMessage, IMAGE_MAX_SIDE } from './utils.js';
import { openModal, toast, confirmDialog, progress } from './ui.js';
import { categoryPicker } from './categories.js';
import { ImageEditor, buildImages, isImageFile, isPdfFile } from './images.js';
import { openPdfImport } from './pdfimport.js';
import { requestPersistence } from './db.js';

/** Ultimi valori usati (inserimento consecutivo). */
let lastValues = null;
/** Modale attualmente aperta (per ricevere incolla / drop globali). */
let activeForm = null;

/** Riceve file dall'esterno (incolla, drop globale, condivisione). */
export function receiveFiles(files) {
  if (activeForm) activeForm.addFiles(files);
  else openTabForm({ files });
}
export const isFormOpen = () => !!activeForm;

/**
 * Apre il form.
 * opts: { id (modifica), files (File[] iniziali), presetCategoryId }
 */
export function openTabForm({ id = null, files = [], presetCategoryId = null } = {}) {
  if (activeForm) { activeForm.addFiles(files); return; }
  const editing = id ? S.state.tabs.get(id) : null;
  if (id && !editing) { toast('Tablatura non trovata.', { type: 'error' }); return; }

  /* ---------- stato del form ---------- */
  const queue = [];            // [{ blob, name, maxSide, group }]
  let current = null;          // elemento della coda in lavorazione
  let replaced = false;        // in modifica: immagine sostituita
  let savedCount = 0;
  const keep = S.state.settings.keepLastValues;
  const init = editing ? editing
    : (keep && lastValues ? { ...lastValues } : { categoryIds: presetCategoryId ? [presetCategoryId] : [], caged: [], keys: [] });
  if (!editing && presetCategoryId && !init.categoryIds.includes(presetCategoryId)) init.categoryIds = [presetCategoryId];
  let caged = (init.caged || []).slice();
  let keys = (init.keys || []).slice();

  /* ---------- markup ---------- */
  const body = html(`<div class="tab-form">
    <section class="tf-image">
      <div class="dropzone" tabindex="0" aria-label="Area di caricamento immagine">
        <p class="dz-title">Trascina qui un'immagine o un PDF</p>
        <p class="muted small">oppure incolla con <kbd>Ctrl</kbd>+<kbd>V</kbd></p>
        <div class="btn-row wrap center">
          <label class="btn primary">📁 Scegli file<input type="file" class="vh" data-in="file" accept="image/*,application/pdf,.pdf" multiple></label>
          <label class="btn">📷 Fotocamera<input type="file" class="vh" data-in="camera" accept="image/*" capture="environment"></label>
        </div>
      </div>
      <div class="tf-editor" hidden></div>
      <div class="tf-image-bar" hidden>
        <span class="tf-queue small muted"></span>
        <label class="btn sm">🔄 ${editing ? 'Sostituisci immagine' : 'Cambia immagine'}<input type="file" class="vh" data-in="replace" accept="image/*,application/pdf,.pdf"></label>
        <button type="button" class="btn sm" data-a="skip" hidden>Salta questa</button>
      </div>
    </section>
    <section class="tf-meta">
      <div class="field"><span class="label">Categorie</span><div class="tf-cats"></div></div>
      <label class="field"><span>Titolo</span><input name="title" maxlength="140" value="${esc(init.title || '')}" placeholder="Facoltativo"></label>
      <label class="field"><span>Descrizione breve</span><input name="description" maxlength="300" value="${esc(init.description || '')}" placeholder="Facoltativa"></label>
      <div class="field"><span class="label">Forme CAGED <small class="muted">(clicca nell'ordine desiderato)</small></span>
        <div class="chips" data-group="caged">${CAGED_SHAPES.map((c) => `<button type="button" class="chip" data-v="${c}" aria-pressed="false">${c}</button>`).join('')}</div>
        <label class="check small"><input type="checkbox" name="cagedOrdered" ${init.cagedOrdered ? 'checked' : ''}> L'ordine è significativo (es. transizione)</label>
        <div class="caged-order small muted"></div>
      </div>
      <div class="field"><span class="label">Tonalità</span>
        <div class="chips keys" data-group="keys">${KEYS.map((k) => `<button type="button" class="chip" data-v="${k}" aria-pressed="false">${k}</button>`).join('')}</div>
        <input name="customKey" maxlength="40" value="${esc(init.customKey || '')}" placeholder="Valore personalizzato (es. Am, E dorico)" aria-label="Tonalità personalizzata">
      </div>
      <label class="field"><span>Note personali</span><textarea name="notes" rows="3" placeholder="Facoltative">${esc(init.notes || '')}</textarea></label>
      <label class="check fav-check"><input type="checkbox" name="favorite" ${init.favorite ? 'checked' : ''}> ★ Preferito</label>
      <details class="tf-adv"><summary>Opzioni avanzate</summary>
        <label class="field"><span>Orientamento nel PDF</span><select name="orientation">
          <option value="auto">Automatico</option><option value="portrait">Verticale</option><option value="landscape">Orizzontale</option></select></label>
        <label class="check"><input type="checkbox" name="pdfOwnPage" ${init.pdf && init.pdf.ownPage ? 'checked' : ''}> Nel PDF, sempre su una pagina dedicata</label>
        <label class="check"><input type="checkbox" name="pdfExclude" ${init.pdf && init.pdf.exclude ? 'checked' : ''}> Escludi dalle raccolte PDF</label>
      </details>
      ${editing ? '' : `<label class="check small"><input type="checkbox" name="keepLast" ${keep ? 'checked' : ''}> Mantieni categoria, CAGED e tonalità per il prossimo inserimento</label>`}
    </section>
  </div>`);
  if (editing) body.querySelector('select[name=orientation]').value = editing.orientation || 'auto';

  const footer = html(`<div class="btn-row wrap">
      <button type="button" class="btn" data-a="cancel">${editing ? 'Annulla' : 'Chiudi'}</button>
      ${editing ? '' : '<button type="button" class="btn" data-a="saveNext">Salva e aggiungi un\'altra</button>'}
      <button type="button" class="btn primary" data-a="save">Salva</button></div>`);

  const modal = openModal({
    title: editing ? 'Modifica tablatura' : 'Nuova tablatura', size: 'lg', body, footer,
    onClose: () => { activeForm = null; document.removeEventListener('keydown', onKey, true); },
  });

  const picker = categoryPicker(init.categoryIds || []);
  body.querySelector('.tf-cats').appendChild(picker.el);
  const editor = new ImageEditor(body.querySelector('.tf-editor'));
  const dz = body.querySelector('.dropzone');

  /* ---------- chip CAGED / tonalità ---------- */
  const drawChips = () => {
    body.querySelectorAll('[data-group=caged] .chip').forEach((b) => {
      const i = caged.indexOf(b.dataset.v);
      b.setAttribute('aria-pressed', String(i >= 0));
      b.dataset.order = i >= 0 && caged.length > 1 ? String(i + 1) : '';
    });
    body.querySelectorAll('[data-group=keys] .chip').forEach((b) => b.setAttribute('aria-pressed', String(keys.includes(b.dataset.v))));
    const ord = body.querySelector('input[name=cagedOrdered]').checked;
    body.querySelector('.caged-order').textContent = caged.length > 1 ? (ord ? `Ordine: ${caged.join(' → ')}` : `Selezionate: ${caged.join(', ')}`) : '';
  };
  body.querySelector('[data-group=caged]').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    const v = b.dataset.v; caged = caged.includes(v) ? caged.filter((x) => x !== v) : [...caged, v]; drawChips();
  });
  body.querySelector('[data-group=keys]').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    const v = b.dataset.v; keys = keys.includes(v) ? keys.filter((x) => x !== v) : [...keys, v]; drawChips();
  });
  body.querySelector('input[name=cagedOrdered]').addEventListener('change', drawChips);
  drawChips();

  /* ---------- gestione immagini / coda ---------- */
  const showEditor = (on) => {
    dz.hidden = on;
    body.querySelector('.tf-editor').hidden = !on;
    body.querySelector('.tf-image-bar').hidden = !on;
  };
  const updateQueueInfo = () => {
    const info = body.querySelector('.tf-queue');
    const total = savedCount + queue.length + (current ? 1 : 0);
    info.textContent = !editing && total > 1 ? `Immagine ${savedCount + 1} di ${total}` : (current ? current.name || '' : '');
    body.querySelector('[data-a=skip]').hidden = !(queue.length > 0);
  };
  const loadNext = async () => {
    current = queue.shift() || null;
    if (!current) { showEditor(false); updateQueueInfo(); return; }
    try {
      await editor.load(current.blob, current.maxSide || IMAGE_MAX_SIDE);
      showEditor(true);
    } catch (e) {
      toast(`"${current.name}": ${errorMessage(e)}`, { type: 'error' });
      current = null;
      return loadNext();
    }
    updateQueueInfo();
  };

  /** Aggiunge file (immagini e PDF) alla coda. */
  const addFiles = async (fileList, { replace = false } = {}) => {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const newItems = [];
    for (const f of files) {
      if (isPdfFile(f)) {
        try {
          const res = await openPdfImport(f, { keepOriginalDefault: S.state.settings.keepOriginalFile });
          if (!res) continue;
          const group = res.keepOriginal ? { original: f, originalName: f.name, savedId: null } : null;
          res.items.forEach((it) => newItems.push({ ...it, group }));
        } catch (e) { toast(errorMessage(e), { type: 'error' }); }
      } else if (isImageFile(f)) {
        const group = S.state.settings.keepOriginalFile ? { original: f, originalName: f.name || 'immagine', savedId: null } : null;
        newItems.push({ blob: f, name: f.name || 'Immagine incollata', group });
      } else {
        toast(`Formato non supportato: ${f.name || f.type || 'file'}`, { type: 'error' });
      }
    }
    if (!newItems.length) return;
    if (editing) {
      // In modifica si usa solo la prima immagine come sostituzione.
      queue.length = 0; queue.push(newItems[0]); replaced = true;
      await loadNext();
      return;
    }
    if (replace || !current) {
      queue.unshift(...newItems);
      await loadNext();
    } else {
      queue.push(...newItems);
      updateQueueInfo();
      toast(`${newItems.length} immagin${newItems.length === 1 ? 'e aggiunta' : 'i aggiunte'} alla coda.`);
    }
  };

  body.querySelectorAll('input[type=file]').forEach((inp) => {
    inp.addEventListener('change', async () => {
      const files = [...inp.files]; inp.value = '';
      await addFiles(files, { replace: inp.dataset.in === 'replace' });
    });
  });
  // Drag & drop sulla modale
  const dropTarget = modal.el.querySelector('.modal');
  dropTarget.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dz.classList.add('over'); } });
  dropTarget.addEventListener('dragleave', () => dz.classList.remove('over'));
  dropTarget.addEventListener('drop', (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault(); e.stopPropagation(); dz.classList.remove('over');
    addFiles(e.dataTransfer.files);
  });
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); body.querySelector('[data-in=file]').click(); } });
  body.querySelector('[data-a=skip]').onclick = () => loadNext();

  /* ---------- salvataggio ---------- */
  const collect = () => {
    const g = (n) => body.querySelector(`[name=${n}]`);
    const customKey = g('customKey').value.trim();
    return {
      title: g('title').value.trim(),
      description: g('description').value.trim(),
      notes: g('notes').value.trim(),
      categoryIds: picker.getSelected(),
      caged: caged.slice(),
      cagedOrdered: g('cagedOrdered').checked && caged.length > 1,
      keys: keys.slice(),
      customKey,
      favorite: g('favorite').checked,
      orientation: g('orientation').value,
      pdf: { ownPage: g('pdfOwnPage').checked, exclude: g('pdfExclude').checked },
    };
  };

  let saving = false;
  const save = async (andNext) => {
    if (saving) return;
    const meta = collect();
    if (!editing && !current) { toast('Aggiungi un\'immagine: è l\'unico campo obbligatorio.', { type: 'warn' }); dz.focus(); return; }
    saving = true;
    footer.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const prog = progress('Salvataggio…');
    try {
      if (editing) {
        let newImages = null;
        if (current && (replaced || editor.edited)) {
          const { canvas, edited } = editor.result();
          newImages = await buildImages(canvas, { originalBlob: replaced ? current.blob : null, edited, maxSide: current.maxSide || IMAGE_MAX_SIDE });
          if (current.group && replaced) { newImages.original = current.group.original; newImages.originalName = current.group.originalName; }
        }
        await S.updateTab(editing.id, meta, newImages);
        prog.close();
        toast('Tablatura aggiornata.', { type: 'success' });
        modal.close(true);
        return;
      }
      const { canvas, edited } = editor.result();
      const images = await buildImages(canvas, { originalBlob: current.blob, edited, maxSide: current.maxSide || IMAGE_MAX_SIDE });
      if (current.group) {
        if (current.group.savedId) images.originalRefId = current.group.savedId;
        else { images.original = current.group.original; images.originalName = current.group.originalName; }
      }
      const tab = await S.createTab(meta, images);
      if (current.group && !current.group.savedId) current.group.savedId = tab.originalId;
      savedCount++;
      requestPersistence();
      // Ultimi valori
      const keepBox = body.querySelector('[name=keepLast]');
      const keepNow = keepBox ? keepBox.checked : keep;
      if (keepBox && keepNow !== S.state.settings.keepLastValues) S.setSetting('keepLastValues', keepNow);
      lastValues = keepNow ? { categoryIds: meta.categoryIds, caged: meta.caged, cagedOrdered: meta.cagedOrdered, keys: meta.keys, customKey: meta.customKey } : null;
      prog.close();
      toast(`Tablatura salvata${meta.categoryIds.length ? '' : ' in “Senza categoria”'}.`, { type: 'success' });
      if (queue.length) {
        resetFields(keepNow);
        await loadNext();
      } else if (andNext) {
        resetFields(keepNow);
        current = null; showEditor(false); updateQueueInfo(); dz.focus();
      } else {
        modal.close(true);
      }
    } catch (e) {
      prog.close();
      console.error(e);
      toast('Salvataggio non riuscito: ' + errorMessage(e), { type: 'error' });
    } finally {
      saving = false;
      footer.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  };

  /** Svuota i campi per il prossimo inserimento (mantiene categoria/CAGED/tonalità se richiesto). */
  const resetFields = (keepValues) => {
    ['title', 'description', 'notes'].forEach((n) => { body.querySelector(`[name=${n}]`).value = ''; });
    body.querySelector('[name=favorite]').checked = false;
    body.querySelector('[name=pdfOwnPage]').checked = false;
    body.querySelector('[name=pdfExclude]').checked = false;
    body.querySelector('[name=orientation]').value = 'auto';
    if (!keepValues) {
      caged = []; keys = [];
      body.querySelector('[name=customKey]').value = '';
      body.querySelector('[name=cagedOrdered]').checked = false;
      picker.setSelected(presetCategoryId ? [presetCategoryId] : []);
    }
    drawChips();
  };

  footer.querySelector('[data-a=save]').onclick = () => save(false);
  const sn = footer.querySelector('[data-a=saveNext]'); if (sn) sn.onclick = () => save(true);
  footer.querySelector('[data-a=cancel]').onclick = async () => {
    if (!editing && (current || queue.length) && !(await confirmDialog('Ci sono immagini non salvate. Chiudere comunque?', { okLabel: 'Chiudi senza salvare', danger: true }))) return;
    modal.close(false);
  };
  // Ctrl+Invio = salva
  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && activeForm) { e.preventDefault(); save(false); } };
  document.addEventListener('keydown', onKey, true);

  activeForm = { addFiles };

  /* ---------- inizializzazione ---------- */
  if (editing) {
    (async () => {
      try {
        const rec = await S.getImageBlob(editing.imageId);
        current = { blob: rec.blob, name: editing.title || 'Immagine attuale', maxSide: Math.max(IMAGE_MAX_SIDE, rec.width || 0, rec.height || 0) };
        await editor.load(rec.blob, current.maxSide);
        showEditor(true); updateQueueInfo();
      } catch (e) {
        toast('Immagine attuale non leggibile: puoi sostituirla. ' + errorMessage(e), { type: 'warn' });
      }
    })();
  } else if (files.length) {
    addFiles(files);
  }
  return modal;
}

/* ===================================================== MODIFICA DI GRUPPO */

/** Modifica di gruppo: categorie (aggiungi/sposta/rimuovi), CAGED, tonalità, preferiti. */
export function openBulkEdit(ids) {
  if (!ids.length) return;
  const body = html(`<form class="form">
    <p class="muted small">${ids.length} tablature selezionate. Compila solo ciò che vuoi modificare.</p>
    <fieldset class="field"><legend>Categorie</legend>
      <label class="check"><input type="radio" name="catMode" value="none" checked> Non modificare</label>
      <label class="check"><input type="radio" name="catMode" value="add"> Aggiungi le categorie selezionate</label>
      <label class="check"><input type="radio" name="catMode" value="move"> Sposta (sostituisci tutte le categorie con quelle selezionate)</label>
      <label class="check"><input type="radio" name="catMode" value="remove"> Rimuovi le categorie selezionate</label>
      <div class="bulk-cats"></div>
    </fieldset>
    <fieldset class="field"><legend>Forme CAGED</legend>
      <label class="check"><input type="checkbox" name="setCaged"> Imposta (sostituisce)</label>
      <div class="chips">${CAGED_SHAPES.map((c) => `<label class="chip-check"><input type="checkbox" name="caged" value="${c}"> ${c}</label>`).join('')}</div>
    </fieldset>
    <fieldset class="field"><legend>Tonalità</legend>
      <label class="check"><input type="checkbox" name="setKeys"> Imposta (sostituisce)</label>
      <div class="chips keys">${KEYS.map((k) => `<label class="chip-check"><input type="checkbox" name="keys" value="${k}"> ${k}</label>`).join('')}</div>
    </fieldset>
    <fieldset class="field"><legend>Preferiti</legend>
      <select name="fav"><option value="">Non modificare</option><option value="1">Segna come preferiti</option><option value="0">Rimuovi dai preferiti</option></select>
    </fieldset></form>`);
  const picker = categoryPicker([]);
  body.querySelector('.bulk-cats').appendChild(picker.el);
  const footer = html(`<div class="btn-row"><button type="button" class="btn" data-a="c">Annulla</button><button type="button" class="btn primary" data-a="ok">Applica</button></div>`);
  const m = openModal({ title: 'Modifica di gruppo', size: 'md', body, footer });
  footer.querySelector('[data-a=c]').onclick = () => m.close();
  footer.querySelector('[data-a=ok]').onclick = async () => {
    const f = new FormData(body);
    const catMode = f.get('catMode');
    const cats = picker.getSelected();
    const setCaged = !!f.get('setCaged'); const cagedV = f.getAll('caged');
    const setKeys = !!f.get('setKeys'); const keysV = f.getAll('keys');
    const fav = f.get('fav');
    if ((catMode === 'add' || catMode === 'remove') && !cats.length) { toast('Seleziona almeno una categoria.', { type: 'warn' }); return; }
    try {
      const n = await S.bulkUpdate(ids, (t) => {
        const p = {};
        if (catMode === 'add') p.categoryIds = [...new Set([...t.categoryIds, ...cats])];
        if (catMode === 'move') p.categoryIds = cats.slice();
        if (catMode === 'remove') p.categoryIds = t.categoryIds.filter((x) => !cats.includes(x));
        if (setCaged) { p.caged = CAGED_SHAPES.filter((c) => cagedV.includes(c)); p.cagedOrdered = false; }
        if (setKeys) p.keys = KEYS.filter((k) => keysV.includes(k));
        if (fav) p.favorite = fav === '1';
        return p;
      });
      toast(`${n} tablature aggiornate.`, { type: 'success' });
      m.close();
    } catch (e) { toast(errorMessage(e), { type: 'error' }); }
  };
}
