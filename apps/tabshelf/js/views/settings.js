/**
 * Impostazioni: account, collegamento di altri dispositivi, verifica, cache locale.
 */
import { APP_VERSION, SCHEMA_VERSION, LIBS } from '../config.js';
import { buildConfigLink } from '../connection.js';
import { checkSchema } from '../sb.js';
import { storageSelfTest, clearLocalCache, localCacheInfo } from '../storage.js';
import { state, activeDocuments, activeCategories, activeTags, spaceUsage } from '../store.js';
import { esc, h, copyText, formatBytes, errorMessage } from '../util.js';
import { toast, toastError, openDialog } from '../ui.js';
import { runBackup } from '../backup.js';
import { spaceSummaryHtml } from './trash.js';

export function renderSettings(el, { session, onSignOut, onDisconnect }) {
  const host = (() => { try { return new URL(session.config.url).host; } catch { return '—'; } })();
  const page = h(`<section class="page narrow">
    <h1>Impostazioni</h1>

    <div class="panel">
      <h2>Account</h2>
      <p>Hai effettuato l'accesso come <strong>${esc(session.user.email || '')}</strong>.</p>
      <div class="row-actions">
        <button type="button" class="btn" data-act="signout">Esci</button>
      </div>
    </div>

    <div class="panel">
      <h2>Collega un altro dispositivo</h2>
      <p>Apri il link (o inquadra il QR code) sul tablet: TabShelf si collegherà al tuo progetto
        e ti chiederà solo email e password.</p>
      <p class="notice">Il link contiene i dati di connessione al progetto (indirizzo e chiave pubblica)
        ma <strong>non</strong> la password. Non pubblicarlo: condividilo solo con i tuoi dispositivi.</p>
      <div class="row-actions">
        <button type="button" class="btn primary" data-act="link">Mostra link e QR code</button>
      </div>
    </div>

    <div class="panel">
      <h2>Verifica collegamento</h2>
      <p>Controlla database, permessi e spazio file con una piccola prova (carica ed elimina un file minuscolo).</p>
      <div class="row-actions"><button type="button" class="btn" data-act="verify">Verifica ora</button></div>
      <ul class="checklist" data-out="verify"></ul>
    </div>

    <div class="panel" id="backup">
      <h2>Backup</h2>
      <p>Crea un file <strong>.zip</strong> con tutti i documenti (esclusi quelli nel cestino), un elenco
        <strong>documenti.csv</strong> apribile in Excel e il file <strong>tabshelf-dati.json</strong> con tag,
        categorie, associazioni e raccolte. Consigliato dal PC.</p>
      <div class="row-actions"><button type="button" class="btn primary" data-act="backup">Crea backup</button></div>
      <div class="backup-progress" hidden>
        <div class="progress"><div class="bar"></div></div>
        <p class="muted small" data-out="backup"></p>
      </div>
    </div>

    <div class="panel">
      <h2>Dati e spazio</h2>
      <dl class="facts" data-out="facts"></dl>
      <div data-out="space"></div>
    </div>

    <div class="panel">
      <h2>Cache delle miniature</h2>
      <p>Le miniature vengono salvate in questo browser per aprire la libreria più in fretta e consumare meno traffico.</p>
      <p data-out="cache" class="muted">…</p>
      <div class="row-actions"><button type="button" class="btn" data-act="clearcache">Svuota la cache</button></div>
    </div>

    <div class="panel">
      <h2>Informazioni</h2>
      <dl class="facts">
        <dt>Versione dell'app</dt><dd>${esc(APP_VERSION)}</dd>
        <dt>Versione dello schema</dt><dd>${SCHEMA_VERSION}</dd>
        <dt>Progetto Supabase</dt><dd><code>${esc(host)}</code></dd>
      </dl>
      <div class="row-actions">
        <button type="button" class="btn danger-outline" data-act="disconnect">Scollega questo dispositivo</button>
      </div>
    </div>
  </section>`);
  el.appendChild(page);

  const facts = page.querySelector('[data-out=facts]');
  const sp = spaceUsage();
  facts.innerHTML = `
    <dt>Documenti</dt><dd>${activeDocuments().length}</dd>
    <dt>Categorie</dt><dd>${activeCategories().length}</dd>
    <dt>Tag</dt><dd>${activeTags().length}</dd>
    <dt>Raccolte preferite</dt><dd>${state.collections.length}</dd>
    <dt>Spazio occupato</dt><dd>${formatBytes(sp.total)} (di cui nel cestino ${formatBytes(sp.trash)})</dd>`;
  page.querySelector('[data-out=space]').innerHTML = spaceSummaryHtml();

  const bBtn = page.querySelector('[data-act=backup]');
  bBtn.onclick = async () => {
    const box = page.querySelector('.backup-progress');
    const bar = box.querySelector('.bar'); const txt = box.querySelector('[data-out=backup]');
    bBtn.disabled = true; box.hidden = false; bar.style.width = '0%'; txt.textContent = 'Preparazione…';
    try {
      const r = await runBackup((p) => { bar.style.width = `${Math.round(p.percent)}%`; txt.textContent = p.text; });
      if (!r) { box.hidden = true; return; }
      txt.textContent = r.failed.length
        ? `Backup creato con ${r.files - r.failed.length} documenti su ${r.files}: ${r.failed.length} file non scaricati (elencati in FILE-MANCANTI.txt).`
        : `Backup creato: ${r.files} documenti${r.savedAs === 'download' ? ' (lo trovi nella cartella Download)' : ''}.`;
      toast('Backup completato.', { type: r.failed.length ? 'warn' : 'ok' });
    } catch (e) {
      txt.textContent = `Backup non riuscito: ${errorMessage(e)}`;
      toastError(e, 'Backup non riuscito');
    } finally { bBtn.disabled = false; }
  };
  if (location.hash.includes('backup')) setTimeout(() => page.querySelector('#backup').scrollIntoView({ block: 'start' }), 50);

  const cacheOut = page.querySelector('[data-out=cache]');
  const refreshCache = () => localCacheInfo().then((i) => { cacheOut.textContent = `Miniature salvate: ${i.count}`; });
  refreshCache();

  page.querySelector('[data-act=signout]').onclick = onSignOut;
  page.querySelector('[data-act=disconnect]').onclick = onDisconnect;
  page.querySelector('[data-act=clearcache]').onclick = async () => {
    await clearLocalCache(); await refreshCache();
    toast('Cache delle miniature svuotata.', { type: 'ok' });
  };
  page.querySelector('[data-act=link]').onclick = () => showLinkDialog(session.config);
  page.querySelector('[data-act=verify]').onclick = (e) => runVerify(e.currentTarget, page.querySelector('[data-out=verify]'));
}

async function showLinkDialog(cfg) {
  const link = buildConfigLink(cfg);
  const isLocal = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  const body = h(`<div class="stack">
    ${isLocal ? '<p class="notice">Stai usando la copia di prova su questo PC (localhost): il link funzionerà solo qui. Per il tablet usa il link dal sito pubblicato.</p>' : ''}
    <div class="qr-box" aria-label="QR code del link di collegamento"><div class="spinner" aria-hidden="true"></div></div>
    <label class="field"><span>Link di collegamento</span>
      <textarea readonly rows="4" class="mono">${esc(link)}</textarea></label>
    <p class="muted small">Contiene i dati di connessione ma non la password.</p>
  </div>`);
  const d = openDialog({
    title: 'Collega un altro dispositivo', size: 'md', body,
    actions: [
      { label: 'Copia link', kind: 'primary', close: false, onClick: async () => {
        const ok = await copyText(link);
        toast(ok ? 'Link copiato negli appunti.' : 'Copia non riuscita: seleziona il testo e copialo a mano.', { type: ok ? 'ok' : 'warn' });
        return false;
      } },
      { label: 'Chiudi', value: null },
    ],
  });
  body.querySelector('textarea').onclick = (e) => e.target.select();
  try {
    const mod = await import(LIBS.qrcode);
    const qrcode = mod.default || mod.qrcode;
    const qr = qrcode(0, 'L');
    qr.addData(link);
    qr.make();
    const box = body.querySelector('.qr-box');
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  } catch (e) {
    body.querySelector('.qr-box').innerHTML = `<p class="muted">QR code non disponibile (${esc(errorMessage(e))}). Usa il link.</p>`;
  }
  return d;
}

async function runVerify(btn, out) {
  btn.disabled = true;
  out.innerHTML = '';
  const add = (ok, text) => out.appendChild(h(`<li class="${ok ? 'ok' : 'ko'}"><span aria-hidden="true">${ok ? '✓' : '✗'}</span> ${esc(text)}</li>`));
  try {
    const s = await checkSchema();
    add(s.ok, s.ok ? `Database preparato (schema versione ${s.found}).` : s.message);
    add(true, `Dati letti: ${state.documents.length} documenti, ${state.tags.length} tag, ${state.categories.length} categorie.`);
    try {
      await storageSelfTest();
      add(true, 'Spazio file: caricamento, lettura ed eliminazione riusciti.');
    } catch (e) {
      add(false, `Spazio file: ${errorMessage(e)} (controlla il bucket "tabshelf" e le regole create da setup.sql).`);
    }
  } catch (e) {
    add(false, errorMessage(e));
  } finally {
    btn.disabled = false;
  }
}
