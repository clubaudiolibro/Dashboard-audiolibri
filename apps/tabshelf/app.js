/**
 * app.js — Avvio di TabShelf: collegamento a Supabase, login, caricamento dati e navigazione.
 *
 * Indirizzi (hash):
 *   #/visualizza  #/carica  #/da-classificare  #/libreria  #/tag  #/cestino  #/impostazioni
 *   #cfg=...      link di configurazione per un nuovo dispositivo (letto e cancellato subito)
 */
import { loadConfig, saveConfig, clearConfig, validateConfig, testConfig, consumeConfigHash } from './js/connection.js';
import { initClient, sb, getUser, signIn, signOut, checkSchema } from './js/sb.js';
import { setStorageUser, clearLocalCache } from './js/storage.js';
import { state, loadAll, onChange, unclassifiedDocuments } from './js/store.js';
import { esc, h, errorMessage } from './js/util.js';
import { toast, toastError } from './js/ui.js';
import { renderSettings } from './js/views/settings.js';
import { renderLibrary } from './js/views/library.js';
import { renderVisualizza } from './js/views/visualizza.js';
import { renderUpload, addFiles } from './js/views/upload.js';
import { renderTags } from './js/views/tags.js';
import { renderTrash } from './js/views/trash.js';
import { SPACE } from './js/config.js';
import { formatBytes } from './js/util.js';
import { setBanner } from './js/ui.js';
import { spaceUsage } from './js/store.js';

const main = document.getElementById('main');
const nav = document.getElementById('main-nav');

export const session = { user: null, config: null };

/** Sezioni dell'app: nome nell'indirizzo -> funzione che disegna la pagina. */
const ROUTES = {
  visualizza: (el) => renderVisualizza(el),
  carica: (el) => renderUpload(el),
  'da-classificare': (el) => renderLibrary(el, { mode: 'unclassified' }),
  libreria: (el) => renderLibrary(el, { mode: 'all' }),
  tag: (el) => renderTags(el),
  cestino: (el) => renderTrash(el),
  impostazioni: (el) => renderSettings(el, { session, onSignOut: doSignOut, onDisconnect: doDisconnect }),
};

/* ================================================================ AVVIO */

boot();

async function boot() {
  registerServiceWorker();

  const fromLink = consumeConfigHash();
  if (fromLink?.error) toast(fromLink.error, { type: 'error' });
  if (fromLink?.applied) toast('Dispositivo collegato a TabShelf. Ora accedi con email e password.', { type: 'ok', duration: 6000 });

  session.config = loadConfig();
  if (!session.config) { showConnect(); return; }
  await afterConfig();
}

/** Con la configurazione salvata: crea il client e verifica la sessione. */
async function afterConfig() {
  try {
    initClient(session.config);
  } catch (e) {
    showFatal(e.message);
    return;
  }

  sb().auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && session.user) {
      session.user = null;
      showLogin('Sei uscito. Accedi di nuovo per continuare.');
    }
  });

  let user = null;
  try { user = await getUser(); } catch { user = null; }
  if (!user) { showLogin(); return; }
  await startApp(user);
}

/** Dopo il login: controlla il database, carica i dati e mostra l'app. */
async function startApp(user) {
  session.user = user;
  setStorageUser(user.id);
  showLoading('Caricamento della libreria…');

  const schema = await checkSchema().catch((e) => ({ ok: false, message: errorMessage(e) }));
  if (!schema.ok) {
    showMessage('Database da preparare', schema.message, [
      { label: 'Riprova', primary: true, onClick: () => startApp(user) },
      { label: 'Esci', onClick: doSignOut },
    ]);
    return;
  }

  try {
    await loadAll();
  } catch (e) {
    showMessage('Impossibile caricare i dati', errorMessage(e), [
      { label: 'Riprova', primary: true, onClick: () => startApp(user) },
      { label: 'Esci', onClick: doSignOut },
    ]);
    return;
  }

  nav.hidden = false;
  onChange(updateBadges);
  updateBadges();
  window.addEventListener('hashchange', route);
  route();
}

/* ================================================================ NAVIGAZIONE */

function defaultRoute() {
  // Sul tablet (schermo touch) si parte dalla visualizzazione, sul PC dalla libreria.
  return window.matchMedia('(pointer: coarse)').matches ? 'visualizza' : 'libreria';
}

let currentCleanup = null;
function route() {
  if (!session.user) return;
  const name = (location.hash.replace(/^#\/?/, '').split('/')[0]) || '';
  if (!ROUTES[name]) {
    history.replaceState(null, '', `#/${defaultRoute()}`);
    return route();
  }
  nav.querySelectorAll('a[data-route]').forEach((a) => {
    if (a.dataset.route === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (typeof currentCleanup === 'function') { try { currentCleanup(); } catch { /* niente */ } }
  main.innerHTML = '';
  main.dataset.route = name;
  currentCleanup = ROUTES[name](main) || null;
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function updateBadges() {
  const n = state.loaded ? unclassifiedDocuments().length : 0;
  const b = document.getElementById('badge-unclassified');
  b.textContent = String(n);
  b.classList.toggle('zero', n === 0);
  updateSpaceBanner();
}

/** Avviso quando il cestino o lo spazio totale superano le soglie (js/config.js). */
function updateSpaceBanner() {
  const sp = spaceUsage();
  const msgs = [];
  if (sp.trash > SPACE.trashWarnBytes) {
    msgs.push(`Il cestino occupa <strong>${formatBytes(sp.trash)}</strong>: <a href="#/cestino">svuotalo</a> per liberare spazio.`);
  }
  if (sp.total > SPACE.quotaBytes * SPACE.quotaWarnRatio) {
    msgs.push(`Stai usando <strong>${formatBytes(sp.total)}</strong> su ${formatBytes(SPACE.quotaBytes)} disponibili nel piano gratuito.`);
  }
  setBanner('space', msgs.length ? `⚠ ${msgs.join(' ')}` : '');
}

/* File trascinati in qualsiasi pagina: si va in "Carica" (invece di aprirli nel browser). */
window.addEventListener('dragover', (e) => {
  if (session.user && [...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (!session.user || !e.dataTransfer?.files?.length) return;
  e.preventDefault();
  if (main.dataset.route === 'carica') return; // ci pensa la pagina Carica
  addFiles(e.dataTransfer.files);
  location.hash = '#/carica';
});

/* ================================================================ SCHERMATE DI ACCESSO */

function showLoading(text) {
  nav.hidden = true;
  main.innerHTML = `<div class="loading-state"><div class="spinner" aria-hidden="true"></div><p>${esc(text)}</p></div>`;
}

function showFatal(message) {
  showMessage('Errore', message, [{ label: 'Ricarica', primary: true, onClick: () => location.reload() }]);
}

function showMessage(title, message, buttons = []) {
  nav.hidden = true;
  const el = h(`<section class="auth-card">
    <h1>${esc(title)}</h1>
    <p>${esc(message)}</p>
    <div class="row-actions"></div>
  </section>`);
  const row = el.querySelector('.row-actions');
  buttons.forEach((b) => {
    const btn = h(`<button type="button" class="btn ${b.primary ? 'primary' : ''}">${esc(b.label)}</button>`);
    btn.onclick = b.onClick;
    row.appendChild(btn);
  });
  main.innerHTML = '';
  main.appendChild(el);
}

/** Primo avvio: incolla Project URL e chiave pubblica. */
function showConnect() {
  nav.hidden = true;
  const el = h(`<section class="auth-card">
    <img src="icons/icon.svg" alt="" width="64" height="64" class="auth-logo">
    <h1>Collega TabShelf</h1>
    <p>Incolla i due dati del tuo progetto Supabase. Li trovi nel pannello di Supabase
      (vedi la guida nel README). Restano salvati solo in questo browser.</p>
    <form class="stack" novalidate>
      <label class="field"><span>Project URL</span>
        <input name="url" type="url" inputmode="url" placeholder="https://xxxxxxxxxxxx.supabase.co" autocomplete="off" autocapitalize="off" spellcheck="false" required>
      </label>
      <label class="field"><span>Chiave pubblica (publishable o anon)</span>
        <textarea name="key" rows="3" placeholder="sb_publishable_…" autocomplete="off" autocapitalize="off" spellcheck="false" required></textarea>
        <small class="muted">Mai la chiave <strong>secret</strong> o <strong>service_role</strong>: l'app la rifiuta.</small>
      </label>
      <p class="form-error" role="alert" hidden></p>
      <button type="submit" class="btn primary big">Collega</button>
    </form>
    <p class="muted small">Hai già TabShelf su un altro dispositivo? Lì, in Impostazioni,
      usa «Collega un altro dispositivo»: con il link o il QR code non devi incollare nulla.</p>
  </section>`);
  const form = el.querySelector('form');
  const err = el.querySelector('.form-error');
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = form.querySelector('button[type=submit]');
    let cfg;
    try {
      cfg = validateConfig(form.url.value, form.key.value);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'Verifica in corso…';
    try {
      const info = await testConfig(cfg);
      saveConfig(cfg);
      if (info.signupDisabled === false) {
        toast('Attenzione: nel progetto la registrazione di nuovi utenti è ancora ATTIVA. Disattivala in Supabase (Authentication).', { type: 'warn', duration: 12000 });
      }
      toast('Progetto collegato. Ora accedi.', { type: 'ok' });
      session.config = loadConfig();
      await afterConfig();
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      btn.disabled = false; btn.textContent = 'Collega';
    }
  };
  main.innerHTML = '';
  main.appendChild(el);
  setTimeout(() => form.url.focus(), 50);
}

/** Login con email e password. */
function showLogin(notice = '') {
  nav.hidden = true;
  const host = (() => { try { return new URL(session.config.url).host; } catch { return ''; } })();
  const el = h(`<section class="auth-card">
    <img src="icons/icon.svg" alt="" width="64" height="64" class="auth-logo">
    <h1>Accedi a TabShelf</h1>
    ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
    <form class="stack">
      <label class="field"><span>Email</span>
        <input name="email" type="email" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false" required>
      </label>
      <label class="field"><span>Password</span>
        <span class="pw-wrap">
          <input name="password" type="password" autocomplete="current-password" required>
          <button type="button" class="btn ghost pw-toggle" aria-label="Mostra password">Mostra</button>
        </span>
      </label>
      <p class="form-error" role="alert" hidden></p>
      <button type="submit" class="btn primary big">Accedi</button>
    </form>
    <p class="muted small">Progetto collegato: <code>${esc(host)}</code> ·
      <button type="button" class="linklike" data-act="change">Cambia progetto</button></p>
  </section>`);
  const form = el.querySelector('form');
  const err = el.querySelector('.form-error');
  el.querySelector('.pw-toggle').onclick = (e) => {
    const show = form.password.type === 'password';
    form.password.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Nascondi' : 'Mostra';
  };
  el.querySelector('[data-act=change]').onclick = doDisconnect;
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Accesso in corso…';
    try {
      const user = await signIn(form.email.value, form.password.value);
      await startApp(user);
    } catch (ex) {
      err.textContent = errorMessage(ex); err.hidden = false;
      btn.disabled = false; btn.textContent = 'Accedi';
    }
  };
  main.innerHTML = '';
  main.appendChild(el);
  setTimeout(() => form.email.focus(), 50);
}

async function doSignOut() {
  session.user = null;
  await signOut();
  await clearLocalCache();
  location.hash = '#/';
  location.reload();
}

async function doDisconnect() {
  const { confirmDialog } = await import('./js/ui.js');
  const ok = await confirmDialog('Questo dispositivo verrà scollegato dal progetto Supabase: dovrai incollare di nuovo Project URL e chiave pubblica (o usare un link di collegamento). I documenti online non vengono toccati.',
    { title: 'Scollega dispositivo', ok: 'Scollega', danger: true });
  if (!ok) return;
  try { if (session.user) await signOut(); } catch { /* niente */ }
  await clearLocalCache();
  clearConfig();
  location.hash = '#/';
  location.reload();
}

/* ================================================================ SERVICE WORKER */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./service-worker.js').catch((e) => console.warn('Service worker non registrato', e));
}

// Errori imprevisti: li mostriamo invece di lasciare la pagina "muta".
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason && e.reason.name === 'AbortError') return;
  toastError(e.reason);
});
