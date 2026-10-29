/**
 * app.js — Punto di ingresso: inizializzazione, navigazione (hash router),
 * barra laterale, pagine Categorie e Strumenti, eventi globali (incolla,
 * trascina, tastiera), service worker, promemoria backup e dati di prova.
 */
import * as db from './js/db.js';
import * as S from './js/store.js';
import { APP_VERSION, esc, html, formatBytes, formatDate, errorMessage, uid, KEYS, CAGED_SHAPES } from './js/utils.js';
import { toast, openModal, closeTopModal, hasOpenModal, confirmDialog, choiceDialog, guard, progress } from './js/ui.js';
import { renderTree, openCategoryForm, mergeCategoriesFlow, expandAll, collapseAll, categoryOptions } from './js/categories.js';
import { renderArchive, setScope, view, getFilteredTabs, onSearchInput, deleteWithUndo, resetFilters } from './js/archive.js';
import { openTabForm, receiveFiles, isFormOpen } from './js/tabform.js';
import { setDeleteHandler } from './js/viewer.js';
import { openPractice, isPracticeOpen } from './js/practice.js';
import { openPdfExport, setResultsProvider } from './js/pdfexport.js';
import { exportBackup, importBackupFlow } from './js/backup.js';
import { makeCanvas, buildImages } from './js/images.js';

const $ = (sel) => document.querySelector(sel);
let route = { page: 'archive' };

/* ================================================================ AVVIO */

async function init() {
  applyTheme('auto');
  try {
    await db.openDB();
    await S.loadAll();
  } catch (e) {
    console.error(e);
    $('#main').innerHTML = `<div class="empty-state"><h2>Impossibile aprire l'archivio locale</h2><p>${esc(errorMessage(e))}</p>
      <p class="muted small">Verifica di non essere in navigazione privata e che il browser consenta l'archiviazione dei dati per questo sito.</p></div>`;
    return;
  }
  applyTheme(S.state.settings.theme);
  setDeleteHandler(deleteWithUndo);
  setResultsProvider(getFilteredTabs);
  bindGlobal();
  S.onChange(() => renderAll());
  window.addEventListener('hashchange', onRoute);
  onRoute();
  registerSW();
  handleShareTarget();
  setTimeout(checkBackupReminder, 1500);
  setTimeout(checkStorage, 2500);
}

/* ================================================================ ROUTER */

function onRoute() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [p, arg] = h.split('/');
  if (p === 'categorie') route = { page: 'categories' };
  else if (p === 'strumenti') route = { page: 'tools' };
  else {
    route = { page: 'archive' };
    if (p === 'preferiti') setScope('favorites');
    else if (p === 'senza-categoria') setScope('uncategorized');
    else if (p === 'categoria' && arg && S.state.categories.has(arg)) setScope('category', arg);
    else setScope('all');
  }
  closeDrawer();
  renderAll();
  $('#main').scrollTop = 0; window.scrollTo(0, 0);
}

function renderAll() {
  renderSidebar();
  $('#total-count').textContent = `${S.state.tabs.size} tablatur${S.state.tabs.size === 1 ? 'a' : 'e'}`;
  const main = $('#main');
  if (route.page === 'categories') renderCategoriesPage(main);
  else if (route.page === 'tools') renderToolsPage(main);
  else renderArchive(main);
  document.querySelectorAll('.bottom-nav [data-nav]').forEach((b) => b.classList.toggle('active', b.dataset.nav === route.page));
}

/* ================================================================ SIDEBAR */

function renderSidebar() {
  const sb = $('#sidebar-content');
  const tabs = [...S.state.tabs.values()];
  const fav = tabs.filter((t) => t.favorite).length;
  const unc = tabs.filter((t) => !t.categoryIds.some((c) => S.state.categories.has(c))).length;
  const isA = route.page === 'archive';
  const lb = S.state.settings.lastBackupAt;
  sb.innerHTML = `
    <button type="button" class="btn primary block" data-act="new">＋ Nuova tablatura</button>
    <nav class="side-section" aria-label="Viste">
      <a href="#/archivio" class="side-link ${isA && view.scope === 'all' ? 'active' : ''}">📚 Tutte <span class="count">${tabs.length}</span></a>
      <a href="#/preferiti" class="side-link ${isA && view.scope === 'favorites' ? 'active' : ''}">★ Preferiti <span class="count">${fav}</span></a>
      <a href="#/senza-categoria" class="side-link ${isA && view.scope === 'uncategorized' ? 'active' : ''}">📥 Senza categoria <span class="count">${unc}</span></a>
    </nav>
    <div class="side-section">
      <div class="side-head"><span>Categorie</span><a href="#/categorie" class="small">Gestisci</a></div>
      <div class="side-tree"></div>
    </div>
    <nav class="side-section" aria-label="Strumenti">
      <button type="button" class="side-link" data-act="practice">▶ Modalità pratica</button>
      <button type="button" class="side-link" data-act="pdf">📄 Crea raccolta PDF</button>
      <a href="#/strumenti" class="side-link ${route.page === 'tools' ? 'active' : ''}">💾 Backup e impostazioni</a>
    </nav>
    <div class="side-foot small muted">
      <div>Ultimo backup: ${lb ? formatDate(lb) : '<span class="warn-text">mai</span>'}</div>
      <div class="storage-line"></div>
    </div>`;
  renderTree(sb.querySelector('.side-tree'), 'nav', {
    activeId: isA && view.scope === 'category' ? view.categoryId : null,
    onOpen: (id) => { location.hash = `#/categoria/${id}`; },
  });
  sb.querySelector('[data-act=new]').onclick = () => openTabForm({ presetCategoryId: isA && view.scope === 'category' ? view.categoryId : null });
  sb.querySelector('[data-act=practice]').onclick = openPracticeLauncher;
  sb.querySelector('[data-act=pdf]').onclick = () => openPdfExport();
  updateStorageLine(sb.querySelector('.storage-line'));
}

async function updateStorageLine(el) {
  const est = await db.storageEstimate();
  if (est && el) el.textContent = `Spazio usato: ${formatBytes(est.usage)}${est.quota ? ` di ${formatBytes(est.quota)}` : ''}`;
}

function openDrawer() { document.body.classList.add('drawer-open'); }
function closeDrawer() { document.body.classList.remove('drawer-open'); }

/* ================================================================ PAGINA CATEGORIE */

function renderCategoriesPage(main) {
  main.innerHTML = `
    <div class="page-head"><h1>Categorie <span class="count-badge">${S.state.categories.size}</span></h1>
      <div class="btn-row wrap">
        <button type="button" class="btn primary" data-a="new">＋ Nuova categoria</button>
        <button type="button" class="btn" data-a="merge">⇉ Unisci categorie</button>
        <button type="button" class="btn" data-a="expand">Espandi tutto</button>
        <button type="button" class="btn" data-a="collapse">Comprimi tutto</button>
      </div></div>
    <p class="muted small">Struttura fino a 4 livelli. I numeri indicano le tablature <em>dirette / totali</em> (incluse le sottocategorie).
      Usa ↑ ↓ o trascina le righe (desktop) per riordinare; ✎ per rinominare o spostare sotto un'altra categoria.</p>
    <div class="cat-manage card-like"></div>`;
  renderTree(main.querySelector('.cat-manage'), 'manage', { onOpen: (id) => { location.hash = `#/categoria/${id}`; } });
  main.querySelector('[data-a=new]').onclick = () => openCategoryForm();
  main.querySelector('[data-a=merge]').onclick = () => mergeCategoriesFlow();
  main.querySelector('[data-a=expand]').onclick = () => { expandAll(); renderAll(); };
  main.querySelector('[data-a=collapse]').onclick = () => { collapseAll(); renderAll(); };
}

/* ================================================================ PAGINA STRUMENTI */

async function renderToolsPage(main) {
  const st = S.state.settings;
  const demoCount = [...S.state.tabs.values()].filter((t) => t.isDemo).length + [...S.state.categories.values()].filter((c) => c.isDemo).length;
  main.innerHTML = `
    <div class="page-head"><h1>Backup e impostazioni</h1></div>
    <section class="panel">
      <h2>💾 Backup</h2>
      <p class="muted small">Il backup (file .zip) contiene immagini, metadati, categorie, preferiti, ordinamenti e impostazioni. È l'unico modo per trasferire l'archivio su un altro dispositivo.</p>
      <p>Ultimo backup: <strong>${st.lastBackupAt ? formatDate(st.lastBackupAt, true) : 'mai eseguito'}</strong></p>
      <div class="btn-row wrap">
        <button type="button" class="btn primary" data-a="export">⬇ Esporta backup</button>
        <label class="btn">⬆ Importa backup<input type="file" class="vh" data-a="import" accept=".zip,application/zip"></label>
      </div>
      <label class="field inline"><span>Promemoria backup</span>
        <select data-s="backupReminderDays">
          ${[[0, 'Disattivato'], [7, 'Ogni 7 giorni'], [14, 'Ogni 14 giorni'], [30, 'Ogni 30 giorni'], [60, 'Ogni 60 giorni']].map(([v, l]) => `<option value="${v}" ${+st.backupReminderDays === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
    </section>
    <section class="panel">
      <h2>📄 Raccolta PDF</h2>
      <p class="muted small">Crea un PDF ordinato con copertina e indice. Il PDF serve per la stampa/consultazione e <strong>non</strong> è un backup ripristinabile.</p>
      <button type="button" class="btn" data-a="pdf">Crea raccolta PDF</button>
    </section>
    <section class="panel">
      <h2>📦 Spazio locale</h2>
      <div class="storage-box">Calcolo…</div>
    </section>
    <section class="panel">
      <h2>⚙ Preferenze</h2>
      <label class="field inline"><span>Tema</span><select data-s="theme">
        <option value="auto" ${st.theme === 'auto' ? 'selected' : ''}>Automatico (sistema)</option>
        <option value="light" ${st.theme === 'light' ? 'selected' : ''}>Chiaro</option>
        <option value="dark" ${st.theme === 'dark' ? 'selected' : ''}>Scuro</option></select></label>
      <label class="check"><input type="checkbox" data-s="keepLastValues" ${st.keepLastValues ? 'checked' : ''}> Inserimento consecutivo: mantieni categoria, CAGED e tonalità</label>
      <label class="check"><input type="checkbox" data-s="includeSubcategories" ${st.includeSubcategories !== false ? 'checked' : ''}> Aprendo una categoria mostra anche le sottocategorie</label>
      <label class="check"><input type="checkbox" data-s="keepOriginalFile" ${st.keepOriginalFile ? 'checked' : ''}> Conserva anche il file originale importato (occupa più spazio)</label>
    </section>
    <section class="panel">
      <h2>🧪 Dati di prova</h2>
      <p class="muted small">Genera tablature fittizie (marcate come “prova”, nella categoria “Dati di prova”) per verificare prestazioni e funzioni. Si rimuovono con un solo comando e non ricompaiono.</p>
      <div class="btn-row wrap">
        <button type="button" class="btn" data-a="demo">Genera 100 tablature di prova</button>
        <button type="button" class="btn danger" data-a="undemo" ${demoCount ? '' : 'disabled'}>Rimuovi dati di prova (${demoCount})</button>
      </div>
    </section>
    <section class="panel danger-zone">
      <h2>⚠ Zona pericolosa</h2>
      <button type="button" class="btn danger" data-a="wipe">Elimina l'intero archivio</button>
    </section>
    <p class="muted small center">Guitar Tab Library v${APP_VERSION} · schema dati v${db.DATA_SCHEMA_VERSION} · tutti i dati restano su questo dispositivo.</p>`;

  main.querySelector('[data-a=export]').onclick = () => exportBackup();
  main.querySelector('[data-a=import]').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importBackupFlow(f); };
  main.querySelector('[data-a=pdf]').onclick = () => openPdfExport();
  main.querySelector('[data-a=demo]').onclick = () => generateDemo(100);
  main.querySelector('[data-a=undemo]').onclick = removeDemo;
  main.querySelector('[data-a=wipe]').onclick = wipeAll;
  main.querySelectorAll('[data-s]').forEach((el) => {
    el.onchange = () => guard(async () => {
      const k = el.dataset.s;
      const v = el.type === 'checkbox' ? el.checked : (k === 'backupReminderDays' ? +el.value : el.value);
      await S.setSetting(k, v);
      if (k === 'theme') applyTheme(v);
      toast('Impostazione salvata.', { type: 'success', duration: 1500 });
    });
  });
  // Spazio
  const box = main.querySelector('.storage-box');
  const est = await db.storageEstimate();
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  if (!box.isConnected) return;
  const imgBytes = [...S.state.tabs.values()].reduce((s, t) => s + (t.imageSize || 0), 0);
  if (est && est.quota) {
    const ratio = est.usage / est.quota;
    box.innerHTML = `<div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(ratio * 100)}"><div style="width:${Math.max(1, Math.min(100, ratio * 100)).toFixed(1)}%" class="${ratio > 0.8 ? 'warn' : ''}"></div></div>
      <p class="small">${formatBytes(est.usage)} usati su ${formatBytes(est.quota)} disponibili per questo sito (${(ratio * 100).toFixed(1).replace('.', ',')}%). Immagini principali: ${formatBytes(imgBytes)}.</p>`;
  } else box.innerHTML = `<p class="small">Il browser non fornisce una stima dello spazio. Immagini principali: ${formatBytes(imgBytes)}.</p>`;
  box.insertAdjacentHTML('beforeend', `<p class="small">Archiviazione persistente: <strong>${persisted ? 'attiva' : 'non garantita'}</strong>
    ${persisted ? '' : '<button type="button" class="btn sm" data-a="persist">Richiedi</button>'}</p>`);
  const pb = box.querySelector('[data-a=persist]');
  if (pb) pb.onclick = async () => { const ok = await db.requestPersistence(); toast(ok ? 'Archiviazione persistente attivata.' : 'Il browser non ha concesso la persistenza (su alcuni browser serve installare l\'app).', { type: ok ? 'success' : 'warn' }); renderAll(); };
}

/* ================================================================ MODALITÀ PRATICA: AVVIO */

function openPracticeLauncher() {
  if (!S.state.tabs.size) { toast('L\'archivio è vuoto.', { type: 'warn' }); return; }
  const results = getFilteredTabs();
  const body = html(`<form class="form">
    <label class="check"><input type="radio" name="src" value="results" checked> Risultati correnti dell'archivio (${results.length})</label>
    <label class="check"><input type="radio" name="src" value="all"> Tutte le tablature (${S.state.tabs.size})</label>
    <label class="check"><input type="radio" name="src" value="fav"> Solo preferiti (${[...S.state.tabs.values()].filter((t) => t.favorite).length})</label>
    <label class="check"><input type="radio" name="src" value="cat"> Una categoria</label>
    <div class="field-row"><select name="cat" aria-label="Categoria">${categoryOptions({ rootLabel: '— Seleziona —' })}</select>
    <label class="check small"><input type="checkbox" name="sub" checked> Includi sottocategorie</label></div>
    <label class="check"><input type="checkbox" name="shuffle"> Ordine casuale</label>
  </form>`);
  const footer = html(`<div class="btn-row"><button type="button" class="btn" data-a="c">Annulla</button><button type="button" class="btn accent" data-a="ok">▶ Avvia</button></div>`);
  const m = openModal({ title: 'Modalità pratica', size: 'sm', body, footer });
  body.cat.onchange = () => { body.querySelector('input[value=cat]').checked = true; };
  footer.querySelector('[data-a=c]').onclick = () => m.close();
  footer.querySelector('[data-a=ok]').onclick = () => {
    const src = body.querySelector('input[name=src]:checked').value;
    let ids; let title;
    const all = [...S.state.tabs.values()].sort((a, b) => a.order - b.order);
    if (src === 'results') { ids = results.map((t) => t.id); title = 'risultati correnti'; }
    else if (src === 'all') { ids = all.map((t) => t.id); title = 'tutte'; }
    else if (src === 'fav') { ids = all.filter((t) => t.favorite).map((t) => t.id); title = 'preferiti'; }
    else {
      const cid = body.cat.value; if (!cid) { toast('Seleziona una categoria.', { type: 'warn' }); return; }
      const set = new Set([cid, ...(body.sub.checked ? S.descendantIds(cid) : [])]);
      ids = all.filter((t) => t.categoryIds.some((c) => set.has(c))).map((t) => t.id);
      title = S.categoryPath(cid);
    }
    if (body.shuffle.checked) ids = ids.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    m.close();
    openPractice(ids, { title });
  };
}

/* ================================================================ EVENTI GLOBALI */

function bindGlobal() {
  const search = $('#search-input');
  search.addEventListener('input', () => {
    if (route.page !== 'archive') { view.query = search.value; location.hash = '#/archivio'; return; }
    onSearchInput(search.value);
  });
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; onSearchInput(''); search.blur(); } });
  $('#btn-new').onclick = () => openTabForm({ presetCategoryId: route.page === 'archive' && view.scope === 'category' ? view.categoryId : null });
  $('#btn-menu').onclick = () => (document.body.classList.contains('drawer-open') ? closeDrawer() : openDrawer());
  $('#drawer-backdrop').onclick = closeDrawer;
  $('#btn-theme').onclick = () => {
    const cur = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    S.setSetting('theme', next); applyTheme(next);
  };
  // Barra di navigazione inferiore (smartphone)
  document.querySelectorAll('.bottom-nav [data-nav]').forEach((b) => {
    b.onclick = () => {
      const n = b.dataset.nav;
      if (n === 'archive') location.hash = '#/archivio';
      else if (n === 'categories') location.hash = '#/categorie';
      else if (n === 'tools') location.hash = '#/strumenti';
      else if (n === 'new') openTabForm({ presetCategoryId: route.page === 'archive' && view.scope === 'category' ? view.categoryId : null });
      else if (n === 'practice') openPracticeLauncher();
      else if (n === 'menu') openDrawer();
    };
  });

  // Incolla immagine (Ctrl+V) ovunque nell'app
  document.addEventListener('paste', (e) => {
    if (isPracticeOpen()) return;
    const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
    const imgs = files.filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf');
    if (!imgs.length) return; // testo: comportamento normale
    e.preventDefault();
    const named = imgs.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `Incollata-${new Date().toLocaleTimeString('it-IT').replace(/:/g, '-')}${i ? '-' + i : ''}.${(f.type.split('/')[1] || 'png')}`, { type: f.type })));
    receiveFiles(named);
  });

  // Trascina e rilascia file sulla finestra
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e) || isFormOpen()) return; dragDepth++; document.body.classList.add('dragging-file'); });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging-file'); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging-file');
    if (e.dataTransfer.files.length && !isPracticeOpen()) receiveFiles([...e.dataTransfer.files]);
  });

  // Tastiera
  document.addEventListener('keydown', (e) => {
    if (isPracticeOpen()) return;
    if (e.key === 'Escape') { if (closeTopModal()) e.preventDefault(); else closeDrawer(); return; }
    const typing = e.target.matches('input, textarea, select, [contenteditable]');
    if (typing || hasOpenModal() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); $('#search-input').focus(); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); $('#btn-new').click(); }
  });

  // Online/offline
  const net = () => document.body.classList.toggle('offline', !navigator.onLine);
  window.addEventListener('online', net); window.addEventListener('offline', net); net();
}

function applyTheme(theme) {
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#14161c' : '#ffffff');
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if ((S.state.settings.theme || 'auto') === 'auto') applyTheme('auto'); });

/* ================================================================ SERVICE WORKER */

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  navigator.serviceWorker.register('./service-worker.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw && nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('È disponibile una nuova versione dell\'app. I tuoi dati non verranno toccati.', {
            duration: 0, action: { label: 'Aggiorna', onClick: () => nw.postMessage({ type: 'SKIP_WAITING' }) },
          });
        }
      });
    });
  }).catch((e) => console.warn('Service worker non registrato', e));
  // Ricarica solo quando un service worker NUOVO sostituisce uno già attivo (aggiornamento),
  // non al primo avvio (clients.claim).
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
}

/** File ricevuti tramite "Condividi" (Android, PWA installata): salvati dal SW in una cache temporanea. */
async function handleShareTarget() {
  const params = new URLSearchParams(location.search);
  if (!params.has('share')) return;
  history.replaceState(null, '', location.pathname + location.hash);
  try {
    const cache = await caches.open('gtl-share-inbox');
    const reqs = await cache.keys();
    const files = [];
    for (const r of reqs) {
      const res = await cache.match(r);
      const blob = await res.blob();
      const name = decodeURIComponent(res.headers.get('X-File-Name') || 'condivisa');
      files.push(new File([blob], name, { type: blob.type }));
      await cache.delete(r);
    }
    if (files.length) receiveFiles(files);
    else if (params.get('share') === 'error') toast('Condivisione non riuscita.', { type: 'error' });
  } catch (e) { toast('Impossibile leggere i file condivisi: ' + errorMessage(e), { type: 'error' }); }
}

/* ================================================================ PROMEMORIA E SPAZIO */

async function checkBackupReminder() {
  const st = S.state.settings;
  const days = +st.backupReminderDays || 0;
  if (!days || !S.state.tabs.size) return;
  const now = Date.now();
  if (st.reminderSnoozedUntil && Date.parse(st.reminderSnoozedUntil) > now) return;
  const ref = Date.parse(st.lastBackupAt || st.firstUseAt || new Date().toISOString());
  const elapsed = Math.floor((now - ref) / 86400000);
  if (elapsed < days) return;
  const msg = st.lastBackupAt ? `Non esegui un backup da ${elapsed} giorni. Vuoi esportarlo adesso?` : `Non hai ancora eseguito un backup (${S.state.tabs.size} tablature). Vuoi esportarlo adesso?`;
  const c = await choiceDialog(msg, [
    { value: 'off', label: 'Disattiva promemoria' },
    { value: 'later', label: 'Più tardi' },
    { value: 'now', label: 'Esporta adesso', primary: true },
  ], { title: 'Promemoria backup' });
  if (c === 'now') exportBackup();
  else if (c === 'off') { await S.setSetting('backupReminderDays', 0); toast('Promemoria disattivato. Puoi riattivarlo in Backup e impostazioni.'); }
  else await S.setSetting('reminderSnoozedUntil', new Date(now + 86400000).toISOString());
}

async function checkStorage() {
  const est = await db.storageEstimate();
  if (!est || !est.quota) return;
  const free = est.quota - est.usage;
  if (est.usage / est.quota > 0.85 || free < 150 * 1024 * 1024) {
    toast(`Spazio locale quasi esaurito (liberi ${formatBytes(free)}). Esporta un backup ed elimina contenuti non necessari.`, { type: 'warn', duration: 10000 });
  }
}

/* ================================================================ DATI DI PROVA */

/** Disegna una tablatura fittizia su canvas (nessun contenuto hardcoded nell'archivio). */
function drawFakeTab(n) {
  const c = makeCanvas(1800, 520);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#222'; ctx.font = 'bold 34px sans-serif';
  ctx.fillText(`Esempio di prova #${n}`, 40, 60);
  ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
  for (let s = 0; s < 6; s++) { const y = 120 + s * 60; ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(1760, y); ctx.stroke(); }
  ctx.font = 'bold 30px monospace';
  'eBGDAE'.split('').forEach((l, s) => ctx.fillText(l, 10, 130 + s * 60));
  for (let x = 100; x < 1720; x += 90) {
    const s = Math.floor(Math.random() * 6); const fret = Math.floor(Math.random() * 15);
    ctx.fillStyle = '#fff'; ctx.fillRect(x - 6, 100 + s * 60, 44, 40);
    ctx.fillStyle = '#111'; ctx.fillText(String(fret), x, 131 + s * 60);
  }
  return c;
}

async function generateDemo(n) {
  if (!(await confirmDialog(`Generare ${n} tablature di prova? Potrai rimuoverle con un solo comando.`, { okLabel: 'Genera' }))) return;
  const prog = progress('Generazione dati di prova…');
  try {
    let root = [...S.state.categories.values()].find((c) => c.isDemo && !c.parentId);
    if (!root) {
      root = await S.createCategory({ name: 'Dati di prova', icon: '🧪' });
      await S.updateCategory(root.id, { isDemo: true });
    }
    const subs = [];
    for (const name of ['Lick', 'Esercizi', 'Canzoni']) {
      let c = S.childrenOf(root.id).find((x) => x.name === name);
      if (!c) { c = await S.createCategory({ name, parentId: root.id }); await S.updateCategory(c.id, { isDemo: true }); }
      subs.push(c);
    }
    for (let i = 1; i <= n; i++) {
      prog.update(`${i} di ${n}`, i / n);
      const images = await buildImages(drawFakeTab(i), { edited: true });
      const shapes = CAGED_SHAPES.filter(() => Math.random() < 0.3);
      await S.createTab({
        title: `Prova ${i}`, description: 'Contenuto generato automaticamente per i test',
        categoryIds: [subs[i % 3].id], caged: shapes, keys: [KEYS[i % KEYS.length]], favorite: i % 7 === 0, isDemo: true,
      }, images);
    }
    prog.close();
    toast(`${n} tablature di prova generate.`, { type: 'success' });
  } catch (e) { prog.close(); toast(errorMessage(e), { type: 'error' }); }
}

async function removeDemo() {
  const tabIds = [...S.state.tabs.values()].filter((t) => t.isDemo).map((t) => t.id);
  const catIds = [...S.state.categories.values()].filter((c) => c.isDemo).map((c) => c.id);
  if (!(await confirmDialog(`Rimuovere ${tabIds.length} tablature e ${catIds.length} categorie di prova?`, { okLabel: 'Rimuovi', danger: true }))) return;
  await guard(async () => {
    const prog = progress('Rimozione dati di prova…');
    await S.deleteTabs(tabIds);
    // dalle foglie verso la radice
    const ordered = catIds.map((id) => S.state.categories.get(id)).filter(Boolean).sort((a, b) => b.level - a.level);
    for (const c of ordered) await S.deleteCategory(c.id, 'unlink');
    prog.close();
    toast('Dati di prova rimossi.', { type: 'success' });
  });
}

async function wipeAll() {
  const c = await choiceDialog(`Eliminare TUTTO l'archivio (${S.state.tabs.size} tablature, ${S.state.categories.size} categorie)? L'operazione è irreversibile.`, [
    { value: null, label: 'Annulla' }, { value: 'backup', label: 'Esporta backup e poi elimina' }, { value: 'wipe', label: 'Elimina tutto', danger: true },
  ], { title: 'Elimina archivio' });
  if (!c) return;
  if (c === 'backup' && !(await exportBackup({ silentSuccess: true }))) return;
  if (!(await confirmDialog('Confermi l\'eliminazione definitiva di tutti i dati?', { okLabel: 'Sì, elimina tutto', danger: true }))) return;
  await guard(async () => {
    const keep = { lastBackupAt: S.state.settings.lastBackupAt };
    await db.clearAll();
    await db.setSetting('lastBackupAt', keep.lastBackupAt);
    S.resetURLCache();
    await S.loadAll();
    resetFilters();
    S.emitChange('wipe');
    toast('Archivio eliminato.', { type: 'success' });
  });
}

// Esportazioni utili per il debug dalla console
window.GTL = { S, db, uid };

init();
