/**
 * Caricamento di nuove tablature: selezione o trascinamento di più file, anteprima,
 * rotazione/ritaglio, titolo/artista/note/tag per file (o per più file insieme),
 * compressione nel browser e coda con avanzamento. Un errore non blocca gli altri file.
 *
 * La coda vive in questo modulo: cambiando pagina i caricamenti proseguono.
 */
import { SPACE, IMAGES } from '../config.js';
import { insertDocument } from '../actions.js';
import { makePaths, uploadFile, removeFiles, primeThumb } from '../storage.js';
import { esc, h, uuid, formatBytes, errorMessage } from '../util.js';
import { openDialog, toast, toastError, promptDialog } from '../ui.js';
import { createTagPicker } from '../tagpicker.js';
import { prepareImage, pdfThumb, previewCanvas, editImage, rotateCanvas, blobToCanvas, resizeCanvas, extFor } from '../images.js';

const CONCURRENCY = 2;
const ACCEPT = '.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf';

/** Elementi della coda. */
const items = [];
let running = 0;
let listEl = null;       // contenitore delle schede (se la pagina è aperta)
let refreshToolbar = () => {};

/* ================================================================ FILE */

function kindOf(file) {
  const name = (file.name || '').toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (['image/jpeg', 'image/png'].includes(file.type) || /\.(jpe?g|png)$/.test(name)) return 'image';
  return null;
}

function titleFromName(name) {
  return String(name || '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function addFiles(fileList) {
  const rejected = [];
  let bigPdf = 0;
  [...fileList].forEach((file) => {
    const kind = kindOf(file);
    if (!kind) { rejected.push(file.name); return; }
    const item = {
      id: uuid(), file, kind,
      title: titleFromName(file.name), artist: '', notes: '', tags: [],
      edited: null, preview: null,
      status: 'ready', step: '', progress: 0, error: '',
      selected: false, el: null, picker: null,
    };
    if (kind === 'pdf' && file.size > SPACE.pdfWarnBytes) bigPdf++;
    items.push(item);
    if (listEl) mountCard(item);
    makePreview(item);
  });
  if (rejected.length) {
    toast(`File non accettati (solo JPG, PNG e PDF): ${rejected.join(', ')}`, { type: 'error', duration: 10000 });
  }
  if (bigPdf) {
    toast(`${bigPdf === 1 ? 'Un PDF supera' : `${bigPdf} PDF superano`} i ${formatBytes(SPACE.pdfWarnBytes)}: verrà caricato così com'è e occuperà più spazio.`, { type: 'warn', duration: 9000 });
  }
  refreshToolbar();
}

/* ================================================================ ANTEPRIME */

let previewing = 0;
const previewQueue = [];
function makePreview(item) {
  previewQueue.push(item);
  pumpPreviews();
}
async function pumpPreviews() {
  while (previewing < 2 && previewQueue.length) {
    const item = previewQueue.shift();
    previewing++;
    (async () => {
      try {
        item.preview = item.edited ? resizeCanvas(item.edited, 320) : await previewCanvas(item.file, item.kind === 'pdf', 320);
      } catch (e) {
        item.status = 'error';
        item.error = item.kind === 'pdf' ? 'PDF non leggibile o protetto.' : 'Immagine non leggibile o danneggiata.';
      }
      updateCard(item);
      refreshToolbar();
    })().finally(() => { previewing--; pumpPreviews(); });
  }
}

/* ================================================================ CODA */

function pending() { return items.filter((i) => i.status === 'queued'); }

export function startAll() {
  items.forEach((i) => { if (i.status === 'ready') { i.status = 'queued'; updateCard(i); } });
  pump();
}

function pump() {
  while (running < CONCURRENCY && pending().length) {
    const item = pending()[0];
    running++;
    processItem(item).finally(() => { running--; pump(); refreshToolbar(); });
  }
  refreshToolbar();
}

async function processItem(item) {
  const uploaded = [];
  const setStep = (step, progress) => { item.step = step; item.progress = progress; updateCard(item); };
  item.status = 'working'; item.error = '';
  try {
    setStep('Preparazione…', 0.1);
    let file; let thumb;
    if (item.kind === 'image') {
      ({ file, thumb } = await prepareImage(item.file, item.edited));
    } else {
      file = item.file;
      thumb = await pdfThumb(item.file);
    }
    const type = item.kind === 'pdf' ? 'application/pdf' : (file.type || 'image/jpeg');
    const paths = makePaths(item.id, extFor(type));

    setStep(`Invio del file (${formatBytes(file.size)})…`, 0.35);
    await uploadFile(paths.file, file, type);
    uploaded.push(paths.file);

    setStep('Invio della miniatura…', 0.75);
    await uploadFile(paths.thumb, thumb, thumb.type);
    uploaded.push(paths.thumb);

    setStep('Salvataggio…', 0.9);
    const clean = (v) => { const s = String(v ?? '').trim(); return s || null; };
    await insertDocument({
      id: item.id,
      title: clean(item.title), artist: clean(item.artist), notes: clean(item.notes),
      original_name: item.file.name,
      file_path: paths.file, thumb_path: paths.thumb,
      file_type: item.kind, file_size: file.size, thumb_size: thumb.size,
    }, item.tags);
    await primeThumb(paths.thumb, thumb);

    item.status = 'done'; item.progress = 1; item.step = '';
    item.savedSize = file.size;
    item.edited = null; // libera memoria
  } catch (e) {
    console.error(e);
    if (uploaded.length) await removeFiles(uploaded).catch(() => {});
    item.status = 'error';
    item.error = errorMessage(e);
  }
  updateCard(item);
}

window.addEventListener('beforeunload', (e) => {
  if (items.some((i) => ['queued', 'working'].includes(i.status))) { e.preventDefault(); e.returnValue = ''; }
});

/* ================================================================ SCHEDE */

function mountCard(item) {
  const el = h(`<article class="up-card" data-id="${item.id}">
    <label class="sel" title="Seleziona"><input type="checkbox" aria-label="Seleziona ${esc(item.file.name)}"></label>
    <div class="up-preview"><div class="spinner" aria-hidden="true"></div></div>
    <div class="up-fields">
      <div class="up-name muted small"></div>
      <div class="up-grid">
        <label class="field"><span>Titolo</span><input type="text" data-f="title"></label>
        <label class="field"><span>Artista</span><input type="text" data-f="artist" list="artist-list"></label>
      </div>
      <div class="field"><span>Tag</span><div class="slot-tags"></div></div>
      <details class="up-notes"><summary>Note</summary><textarea data-f="notes" rows="2"></textarea></details>
    </div>
    <div class="up-side">
      <div class="up-tools">
        <button type="button" class="btn" data-act="rotate" title="Ruota di 90° a destra">⟳ Ruota</button>
        <button type="button" class="btn" data-act="edit">✂ Ritaglia…</button>
      </div>
      <div class="up-status" aria-live="polite"></div>
      <div class="progress" hidden><div class="bar"></div></div>
      <div class="up-actions">
        <button type="button" class="btn primary" data-act="retry" hidden>Riprova</button>
        <button type="button" class="btn ghost" data-act="remove">Togli</button>
      </div>
    </div>
  </article>`);
  item.el = el;
  el.querySelector('.up-name').textContent = `${item.file.name} · ${formatBytes(item.file.size)}`;
  el.querySelectorAll('[data-f]').forEach((inp) => {
    inp.value = item[inp.dataset.f];
    inp.addEventListener('input', () => { item[inp.dataset.f] = inp.value; });
  });
  item.picker = createTagPicker({ value: item.tags, onChange: (ids) => { item.tags = ids; } });
  el.querySelector('.slot-tags').appendChild(item.picker.el);
  el.querySelector('.sel input').onchange = (e) => { item.selected = e.target.checked; el.classList.toggle('selected', item.selected); refreshToolbar(); };

  el.querySelector('[data-act=remove]').onclick = () => {
    const i = items.indexOf(item);
    if (i >= 0) items.splice(i, 1);
    el.remove(); refreshToolbar();
  };
  el.querySelector('[data-act=retry]').onclick = () => { item.status = 'queued'; updateCard(item); pump(); };
  el.querySelector('[data-act=rotate]').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const base = item.edited || resizeCanvas(await blobToCanvas(item.file), IMAGES.maxSide);
      item.edited = rotateCanvas(base, 90);
      item.preview = resizeCanvas(item.edited, 320);
      updateCard(item);
    } catch (err) { toastError(err); } finally { b.disabled = false; }
  };
  el.querySelector('[data-act=edit]').onclick = async () => {
    try {
      const c = await editImage(item.edited || item.file, `Ruota e ritaglia: ${item.file.name}`);
      if (c) { item.edited = c; item.preview = resizeCanvas(c, 320); updateCard(item); }
    } catch (err) { toastError(err); }
  };
  listEl.appendChild(el);
  updateCard(item);
}

function updateCard(item) {
  const el = item.el;
  if (!el || !el.isConnected) return;
  const prev = el.querySelector('.up-preview');
  if (item.preview && prev.firstElementChild !== item.preview) {
    prev.innerHTML = '';
    prev.appendChild(item.preview);
    if (item.kind === 'pdf') prev.insertAdjacentHTML('beforeend', '<span class="type-badge">PDF</span>');
  }
  if (!item.preview && item.status === 'error') prev.innerHTML = '<span class="muted">⚠</span>';
  const isImage = item.kind === 'image';
  const locked = ['queued', 'working', 'done'].includes(item.status);
  el.querySelector('.up-tools').hidden = !isImage || locked;
  el.querySelectorAll('input, textarea').forEach((x) => { if (!x.closest('.sel')) x.disabled = locked; });
  el.querySelector('.tagpicker').classList.toggle('disabled', locked);
  el.classList.toggle('done', item.status === 'done');
  el.classList.toggle('error', item.status === 'error');

  const st = el.querySelector('.up-status');
  const bar = el.querySelector('.progress');
  const warn = item.kind === 'pdf' && item.file.size > SPACE.pdfWarnBytes
    ? `<span class="warn-text">PDF grande (${formatBytes(item.file.size)})</span>` : '';
  const texts = {
    ready: `Pronto ${item.edited ? '· modificato' : ''} ${warn}`,
    queued: 'In coda…',
    working: esc(item.step),
    done: `<span class="ok-text">✓ Caricato</span> <span class="muted small">(${formatBytes(item.savedSize || 0)})</span>`,
    error: `<span class="err-text">✗ ${esc(item.error)}</span>`,
  };
  st.innerHTML = texts[item.status] || '';
  bar.hidden = !['queued', 'working'].includes(item.status);
  bar.querySelector('.bar').style.width = `${Math.round(item.progress * 100)}%`;
  el.querySelector('[data-act=retry]').hidden = item.status !== 'error' || !item.preview;
  el.querySelector('[data-act=remove]').hidden = ['queued', 'working'].includes(item.status);
}

/* ================================================================ PAGINA */

export function renderUpload(el) {
  const page = h(`<section class="page">
    <div class="page-head"><h1>Carica</h1></div>
    <div class="dropzone" tabindex="0" role="button" aria-label="Scegli i file da caricare">
      <div class="dz-icon" aria-hidden="true">⇪</div>
      <p><strong>Trascina qui le tablature</strong> oppure <span class="linklike">scegli i file</span></p>
      <p class="muted small">JPG, PNG e PDF. Le immagini vengono ridotte (lato lungo ${IMAGES.maxSide} px) e compresse prima dell'invio.</p>
      <input type="file" multiple accept="${ACCEPT}" hidden>
    </div>
    <div class="up-toolbar" hidden>
      <label class="selall"><input type="checkbox"> <span>Seleziona tutti</span></label>
      <span class="sel-actions" hidden>
        <button type="button" class="btn" data-bulk="tags">Tag ai selezionati</button>
        <button type="button" class="btn" data-bulk="artist">Artista ai selezionati</button>
        <button type="button" class="btn ghost" data-bulk="remove">Togli i selezionati</button>
      </span>
      <span class="spacer"></span>
      <span class="up-summary muted"></span>
      <button type="button" class="btn ghost" data-act="cleardone" hidden>Togli i completati</button>
      <button type="button" class="btn primary big" data-act="start">Carica tutti</button>
    </div>
    <datalist id="artist-list"></datalist>
    <div class="up-list"></div>
  </section>`);
  el.appendChild(page);

  const dz = page.querySelector('.dropzone');
  const input = dz.querySelector('input[type=file]');
  listEl = page.querySelector('.up-list');
  const toolbar = page.querySelector('.up-toolbar');
  const selAll = toolbar.querySelector('.selall input');

  // Elenco artisti già usati, per l'autocompletamento
  import('../store.js').then(({ state }) => {
    const names = [...new Set(state.documents.map((d) => d.artist).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
    page.querySelector('#artist-list').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
  });

  dz.onclick = (e) => { if (e.target !== input) input.click(); };
  dz.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
  input.onchange = () => { addFiles(input.files); input.value = ''; };

  // Trascinamento: su tutta la pagina mentre si è in "Carica"
  let depth = 0;
  const onEnter = (e) => { if (hasFiles(e)) { e.preventDefault(); depth++; dz.classList.add('over'); } };
  const onOver = (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } };
  const onLeave = () => { depth = Math.max(0, depth - 1); if (!depth) dz.classList.remove('over'); };
  const onDrop = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; dz.classList.remove('over');
    addFiles(e.dataTransfer.files);
  };
  window.addEventListener('dragenter', onEnter);
  window.addEventListener('dragover', onOver);
  window.addEventListener('dragleave', onLeave);
  window.addEventListener('drop', onDrop);

  refreshToolbar = () => {
    if (!toolbar.isConnected) return;
    toolbar.hidden = items.length === 0;
    const sel = items.filter((i) => i.selected);
    toolbar.querySelector('.sel-actions').hidden = sel.length === 0;
    selAll.checked = sel.length > 0 && sel.length === items.length;
    selAll.indeterminate = sel.length > 0 && sel.length < items.length;
    const ready = items.filter((i) => i.status === 'ready').length;
    const busy = items.filter((i) => ['queued', 'working'].includes(i.status)).length;
    const done = items.filter((i) => i.status === 'done').length;
    const err = items.filter((i) => i.status === 'error').length;
    const parts = [];
    if (busy) parts.push(`${busy} in corso`);
    if (done) parts.push(`${done} caricat${done === 1 ? 'o' : 'i'}`);
    if (err) parts.push(`${err} con errori`);
    toolbar.querySelector('.up-summary').textContent = parts.join(' · ');
    const start = toolbar.querySelector('[data-act=start]');
    start.textContent = ready ? `Carica ${ready === 1 ? '1 file' : `tutti (${ready})`}` : 'Carica tutti';
    start.disabled = ready === 0;
    toolbar.querySelector('[data-act=cleardone]').hidden = done === 0;
  };

  selAll.onchange = () => {
    items.forEach((i) => { i.selected = selAll.checked; i.el?.classList.toggle('selected', i.selected); const cb = i.el?.querySelector('.sel input'); if (cb) cb.checked = i.selected; });
    refreshToolbar();
  };
  toolbar.querySelector('[data-act=start]').onclick = startAll;
  toolbar.querySelector('[data-act=cleardone]').onclick = () => {
    for (let k = items.length - 1; k >= 0; k--) if (items[k].status === 'done') { items[k].el?.remove(); items.splice(k, 1); }
    refreshToolbar();
  };
  toolbar.querySelector('[data-bulk=remove]').onclick = () => {
    for (let k = items.length - 1; k >= 0; k--) {
      const it = items[k];
      if (it.selected && !['queued', 'working'].includes(it.status)) { it.el?.remove(); items.splice(k, 1); }
    }
    refreshToolbar();
  };
  toolbar.querySelector('[data-bulk=artist]').onclick = async () => {
    const sel = items.filter((i) => i.selected && i.status === 'ready');
    if (!sel.length) return;
    const v = await promptDialog(`Artista per ${sel.length} file`, { title: 'Artista ai selezionati', ok: 'Applica' });
    if (v === null) return;
    sel.forEach((i) => { i.artist = v; const inp = i.el?.querySelector('[data-f=artist]'); if (inp) inp.value = v; });
  };
  toolbar.querySelector('[data-bulk=tags]').onclick = async () => {
    const sel = items.filter((i) => i.selected && i.status !== 'done');
    if (!sel.length) return;
    const picker = createTagPicker({ placeholder: 'Scrivi per cercare o creare un tag…' });
    const body = h(`<div class="stack"><p>Tag da aggiungere a ${sel.length} file:</p></div>`);
    body.appendChild(picker.el);
    const d = openDialog({
      title: 'Tag ai selezionati', body,
      actions: [
        { label: 'Annulla', value: null },
        { label: 'Aggiungi', kind: 'primary', onClick: () => {
          if (!picker.value.length) { picker.focus(); return false; }
          sel.forEach((i) => { i.tags = [...new Set([...i.tags, ...picker.value])]; i.picker.value = i.tags; });
          return true;
        } },
      ],
    });
    setTimeout(() => picker.focus(), 30);
    await d.result;
  };

  items.forEach(mountCard);
  refreshToolbar();

  return () => {
    window.removeEventListener('dragenter', onEnter);
    window.removeEventListener('dragover', onOver);
    window.removeEventListener('dragleave', onLeave);
    window.removeEventListener('drop', onDrop);
    listEl = null;
    refreshToolbar = () => {};
  };
}

function hasFiles(e) {
  return e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
}
