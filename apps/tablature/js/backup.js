/**
 * backup.js — Esportazione e importazione dell'archivio come file .zip (JSZip).
 *
 * Struttura del file:
 *   backup.json            metadati, tablature, categorie, impostazioni, elenco immagini
 *   images/<id>.<ext>      un file per ogni immagine (principale, miniatura, originale)
 *
 * L'importazione può unire il backup all'archivio attuale (senza sovrascrivere nulla)
 * oppure sostituirlo del tutto.
 */
import * as db from './db.js';
import * as S from './store.js';
import { APP_VERSION, isoDay, downloadBlob, extFromMime, mimeFromExt, errorMessage, UserError, formatBytes, formatDate, nextFrame } from './utils.js';
import { toast, progress, choiceDialog, confirmDialog } from './ui.js';

const FORMAT = 'guitar-tab-library-backup';
/** Impostazioni che non vengono ripristinate (legate al dispositivo o allo stato locale). */
const LOCAL_ONLY_SETTINGS = new Set(['theme', 'lastBackupAt', 'firstUseAt', 'reminderSnoozedUntil', 'schemaVersion']);

function needZip() {
  if (!globalThis.JSZip) {
    throw new UserError(navigator.onLine
      ? 'La libreria per i file ZIP non è stata caricata. Ricarica la pagina e riprova.'
      : 'La libreria per i file ZIP non è ancora disponibile offline: apri l\'app almeno una volta con la connessione attiva.');
  }
  return globalThis.JSZip;
}

/* ================================================================== ESPORTA */

/**
 * Crea e scarica il backup. Restituisce true se il file è stato generato.
 * opts.silentSuccess: non mostrare il messaggio finale (usato prima di un'eliminazione).
 */
export async function exportBackup({ silentSuccess = false } = {}) {
  let prog = null;
  try {
    const JSZip = needZip();
    prog = progress('Creazione del backup…');
    const zip = new JSZip();
    const tabs = [...S.state.tabs.values()];
    const wanted = new Set();
    tabs.forEach((t) => [t.imageId, t.thumbId, t.originalId].forEach((id) => id && wanted.add(id)));

    const images = [];
    let n = 0;
    await db.forEachImage(async (rec) => {
      if (!wanted.has(rec.id) || !rec.blob) return;
      const mime = rec.mime || rec.blob.type || 'application/octet-stream';
      const file = `images/${rec.id}.${extFromMime(mime)}`;
      zip.file(file, rec.blob, { binary: true, compression: 'STORE' }); // già compresse
      images.push({ id: rec.id, tabId: rec.tabId, kind: rec.kind, mime, width: rec.width || 0, height: rec.height || 0, size: rec.size || rec.blob.size, name: rec.name || '', file });
      if (++n % 10 === 0) { prog.update(`Immagine ${n} di ${wanted.size}`, 0.4 * Math.min(1, n / Math.max(1, wanted.size))); await nextFrame(); }
    });

    const settings = {};
    for (const [k, v] of Object.entries(S.state.settings)) if (!LOCAL_ONLY_SETTINGS.has(k)) settings[k] = v;
    const exportedAt = new Date().toISOString();
    zip.file('backup.json', JSON.stringify({
      format: FORMAT, schemaVersion: db.DATA_SCHEMA_VERSION, appVersion: APP_VERSION, exportedAt,
      counts: { tabs: tabs.length, categories: S.state.categories.size, images: images.length },
      tabs, categories: [...S.state.categories.values()], settings, images,
    }), { compression: 'DEFLATE' });

    const blob = await zip.generateAsync({ type: 'blob', streamFiles: true }, (m) => prog.update(`Compressione… ${Math.round(m.percent)}%`, 0.4 + 0.6 * (m.percent / 100)));
    downloadBlob(blob, `guitar-tab-library-backup-${isoDay()}.zip`);
    await S.setSetting('lastBackupAt', exportedAt);
    prog.close(); prog = null;
    S.emitChange('backup');
    if (!silentSuccess) toast(`Backup creato (${tabs.length} tablature, ${formatBytes(blob.size)}). Conserva il file in un posto sicuro.`, { type: 'success', duration: 6000 });
    return true;
  } catch (e) {
    console.error(e);
    if (prog) prog.close();
    toast('Backup non riuscito: ' + errorMessage(e), { type: 'error' });
    return false;
  }
}

/* ================================================================== IMPORTA */

/** Legge e controlla backup.json; restituisce { zip, data }. */
async function readBackup(file) {
  const JSZip = needZip();
  let zip;
  try { zip = await JSZip.loadAsync(file); } catch { throw new UserError('Il file non è un archivio ZIP valido.'); }
  const entry = zip.file('backup.json');
  if (!entry) throw new UserError('Il file non è un backup di Guitar Tab Library (manca backup.json).');
  let data;
  try { data = JSON.parse(await entry.async('string')); } catch { throw new UserError('Il backup è danneggiato (backup.json non leggibile).'); }
  if (!data || data.format !== FORMAT || !Array.isArray(data.tabs) || !Array.isArray(data.categories) || !Array.isArray(data.images)) {
    throw new UserError('Il file non è un backup valido di Guitar Tab Library.');
  }
  if ((data.schemaVersion || 1) > db.DATA_SCHEMA_VERSION) {
    throw new UserError('Il backup è stato creato da una versione più recente dell\'app. Aggiorna l\'app e riprova.');
  }
  return { zip, data };
}

/** Importa un backup scelto dall'utente (chiede se unire o sostituire). */
export async function importBackupFlow(file) {
  let prog = null;
  try {
    prog = progress('Lettura del backup…');
    const { zip, data } = await readBackup(file);
    prog.close(); prog = null;

    const hasData = S.state.tabs.size > 0 || S.state.categories.size > 0;
    const when = data.exportedAt ? formatDate(data.exportedAt, true) : 'data sconosciuta';
    let mode = 'replace';
    if (hasData) {
      mode = await choiceDialog(
        `Backup del ${when}: ${data.tabs.length} tablature e ${data.categories.length} categorie.\nL'archivio attuale contiene ${S.state.tabs.size} tablature.\n\n“Unisci” aggiunge ciò che manca senza toccare l'archivio attuale; “Sostituisci” cancella l'archivio attuale e ripristina il backup.`,
        [{ value: null, label: 'Annulla' }, { value: 'merge', label: 'Unisci', primary: true }, { value: 'replace', label: 'Sostituisci tutto', danger: true }],
        { title: 'Importa backup' });
      if (!mode) return false;
      if (mode === 'replace' && !(await confirmDialog('Sostituire l\'intero archivio attuale con il backup? L\'operazione non si può annullare.', { okLabel: 'Sostituisci', danger: true }))) return false;
    } else if (!(await confirmDialog(`Ripristinare il backup del ${when} (${data.tabs.length} tablature)?`, { okLabel: 'Ripristina' }))) return false;

    prog = progress('Ripristino in corso…');
    const result = await applyBackup(zip, data, mode, prog);
    prog.close(); prog = null;
    const skipped = result.skipped ? ` ${result.skipped} non importat${result.skipped === 1 ? 'a' : 'e'} (già presenti o incomplete).` : '';
    toast(`Ripristinate ${result.tabs} tablature e ${result.categories} categorie.${skipped}`, { type: result.tabs || !result.skipped ? 'success' : 'warn', duration: 7000 });
    return true;
  } catch (e) {
    console.error(e);
    if (prog) prog.close();
    toast('Importazione non riuscita: ' + errorMessage(e), { type: 'error', duration: 9000 });
    return false;
  }
}

async function applyBackup(zip, data, mode, prog) {
  const replace = mode === 'replace';
  const existingTabs = replace ? new Set() : new Set(S.state.tabs.keys());
  const existingCats = replace ? new Set() : new Set(S.state.categories.keys());

  // Tablature importabili: record valido, non già presente, con immagine principale nel file.
  const imgMeta = new Map(data.images.filter((i) => i && i.id && i.file).map((i) => [i.id, i]));
  const hasFile = (id) => { const m = imgMeta.get(id); return !!(m && zip.file(m.file)); };
  const good = [];
  let skipped = 0;
  for (const raw of data.tabs) {
    if (!raw || !raw.id || existingTabs.has(raw.id) || !hasFile(raw.imageId)) { skipped++; continue; }
    try {
      const t = S.normalizeTab(raw);
      if (!hasFile(t.thumbId)) t.thumbId = t.imageId;
      if (t.originalId && !hasFile(t.originalId)) t.originalId = null;
      good.push(t);
    } catch { skipped++; }
  }

  // Sostituzione: si svuota solo quando il backup è risultato leggibile.
  if (replace) {
    // Le impostazioni legate al dispositivo (tema, ultimo backup…) sopravvivono alla sostituzione.
    const local = [...LOCAL_ONLY_SETTINGS].filter((k) => k !== 'schemaVersion' && S.state.settings[k] != null).map((key) => ({ key, value: S.state.settings[key] }));
    await db.clearAll(); S.resetURLCache();
    if (local.length) await db.batch([{ store: 'settings', put: local }]);
  }

  // Immagini (a lotti, per non tenere tutto in memoria)
  const need = new Set();
  good.forEach((t) => [t.imageId, t.thumbId, t.originalId].forEach((id) => id && need.add(id)));
  const existingImages = replace ? new Set() : new Set(await db.getImageKeys());
  const ids = [...need].filter((id) => !existingImages.has(id));
  let batch = []; let batchBytes = 0; let done = 0;
  const flush = async () => { if (batch.length) { await db.batch([{ store: 'images', put: batch }]); batch = []; batchBytes = 0; } };
  for (const id of ids) {
    const m = imgMeta.get(id);
    const mime = m.mime || mimeFromExt(m.file);
    const raw = await zip.file(m.file).async('blob');
    const blob = new Blob([raw], { type: mime });
    batch.push({ id, tabId: m.tabId, kind: m.kind, blob, mime, width: m.width || 0, height: m.height || 0, size: blob.size, ...(m.name ? { name: m.name } : {}) });
    batchBytes += blob.size;
    if (batch.length >= 25 || batchBytes > 40 * 1024 * 1024) await flush();
    prog.update(`Immagine ${++done} di ${ids.length}`, ids.length ? done / ids.length : 1);
    if (done % 5 === 0) await nextFrame();
  }
  await flush();

  // Categorie, tablature e impostazioni
  const cats = data.categories.filter((c) => c && c.id && typeof c.name === 'string' && !existingCats.has(c.id)).map(S.normalizeCategory);
  await db.batch([{ store: 'categories', put: cats }, { store: 'tabs', put: good }]);
  if (replace && data.settings && typeof data.settings === 'object') {
    const rec = Object.entries(data.settings).filter(([k]) => !LOCAL_ONLY_SETTINGS.has(k)).map(([key, value]) => ({ key, value }));
    if (rec.length) await db.batch([{ store: 'settings', put: rec }]);
  }
  await S.loadAll(); // rilegge tutto e ripara l'eventuale gerarchia incoerente
  S.resetURLCache();
  S.emitChange('import');
  return { tabs: good.length, categories: cats.length, skipped };
}
