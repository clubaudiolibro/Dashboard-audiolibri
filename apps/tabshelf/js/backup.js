/**
 * backup.js — Backup completo in un file .zip (escluso il cestino).
 *
 * Contenuto dello zip:
 *   documenti/<titolo o nome originale> - <id breve>.<estensione>   i file così come sono nello storage
 *   tabshelf-dati.json   documenti, categorie, tag, associazioni, raccolte, versione dello schema
 *   documenti.csv        elenco apribile in Excel (separatore ;  UTF-8 con BOM)
 *
 * I file vengono scaricati uno alla volta. Dove il browser lo permette (Edge/Chrome sul PC)
 * lo zip viene scritto direttamente su disco mentre si crea, senza tenerlo tutto in memoria.
 */
import { SCHEMA_VERSION, APP_VERSION, LIBS, STATUSES } from './config.js';
import { state, activeCategories, activeTags, activeDocuments, compareTags } from './store.js';
import { downloadBlob } from './storage.js';
import { loadScript } from './util.js';
import { docTitle } from './filter.js';

/** Nome di file sicuro per Windows. */
export function safeName(s, max = 80) {
  return String(s || '').normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
    .slice(0, max).trim() || 'documento';
}

function extOf(doc) {
  const m = String(doc.file_path || '').match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : (doc.file_type === 'pdf' ? 'pdf' : 'bin');
}

/** Valore CSV (separatore ;) con virgolette quando serve. */
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Prepara i dati (senza il cestino) e i nomi dei file nello zip. */
export function buildBackupData() {
  const cats = activeCategories();
  const tags = activeTags().sort(compareTags);
  const tagIds = new Set(tags.map((t) => t.id));
  const docs = activeDocuments().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const used = new Set();
  const zipPath = new Map();
  docs.forEach((d) => {
    const base = (d.title && d.title.trim()) || String(d.original_name || '').replace(/\.[a-z0-9]{1,5}$/i, '') || 'documento';
    let name = `documenti/${safeName(base)} - ${d.id.slice(0, 8)}.${extOf(d)}`;
    while (used.has(name.toLowerCase())) name = name.replace(/(\.[a-z0-9]+)$/i, '_$1');
    used.add(name.toLowerCase());
    zipPath.set(d.id, name);
  });
  const links = [];
  docs.forEach((d) => state.docTags.get(d.id)?.forEach((t) => { if (tagIds.has(t)) links.push({ document_id: d.id, tag_id: t }); }));
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k] ?? null]));
  const json = {
    app: 'TabShelf',
    app_version: APP_VERSION,
    schema_version: SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    categories: cats.map((c) => pick(c, ['id', 'name', 'sort_order', 'created_at'])),
    tags: tags.map((t) => pick(t, ['id', 'category_id', 'name', 'color', 'sort_order', 'created_at'])),
    documents: docs.map((d) => ({
      ...pick(d, ['id', 'title', 'artist', 'notes', 'original_name', 'file_type', 'file_size', 'status', 'mastery', 'created_at']),
      file: zipPath.get(d.id),
    })),
    document_tags: links,
    collections: state.collections.map((c) => pick(c, ['id', 'name', 'filter', 'created_at'])),
  };
  // CSV per Excel
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const tagLabel = new Map(tags.map((t) => [t.id, `${catName.get(t.category_id)}: ${t.name}`]));
  const rank = new Map(tags.map((t, i) => [t.id, (cats.findIndex((c) => c.id === t.category_id) * 10000) + i]));
  const header = ['Titolo', 'Artista', 'Tag', 'Stato', 'Voto', 'Note', 'Nome file originale', 'Tipo', 'Dimensione (KB)', 'Data di caricamento', 'File nel backup', 'ID'];
  const rows = docs.map((d) => {
    const dt = links.filter((l) => l.document_id === d.id).map((l) => l.tag_id).sort((a, b) => rank.get(a) - rank.get(b));
    const date = d.created_at ? new Date(d.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    return [d.title || '', d.artist || '', dt.map((t) => tagLabel.get(t)).join(' | '),
      STATUSES.find((s) => s.id === d.status)?.label || '', d.mastery || '', d.notes || '', d.original_name || '',
      d.file_type === 'pdf' ? 'PDF' : 'Immagine', String(Math.round((Number(d.file_size) || 0) / 1024)), date,
      zipPath.get(d.id), d.id];
  });
  const csv = `﻿${[header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
  return { json, csv, docs, zipPath };
}

/**
 * Crea e salva il backup.
 * onProgress({ phase: 'files'|'zip', done, total, percent, text })
 * Restituisce { files, failed: [nomi], savedAs }.
 */
export async function runBackup(onProgress = () => {}) {
  const fileName = `tabshelf-backup-${new Date().toISOString().slice(0, 10)}.zip`;

  // Dove possibile si sceglie subito dove salvare (serve il clic dell'utente ancora "fresco").
  let writable = null;
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'Archivio ZIP', accept: { 'application/zip': ['.zip'] } }],
      });
      writable = await handle.createWritable();
    } catch (e) {
      if (e.name === 'AbortError') return null; // l'utente ha annullato
      writable = null; // si ripiega sul download normale
    }
  }

  await loadScript(LIBS.jszip);
  const zip = new window.JSZip();
  const { json, csv, docs, zipPath } = buildBackupData();
  zip.file('tabshelf-dati.json', JSON.stringify(json, null, 2));
  zip.file('documenti.csv', csv);

  const failed = [];
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    onProgress({ phase: 'files', done: i, total: docs.length, percent: (i / Math.max(1, docs.length)) * 80, text: `Scarico ${i + 1} di ${docs.length}: ${docTitle(d)}` });
    try {
      const blob = await downloadBlob(d.file_path);
      // Immagini e PDF sono già compressi: si archiviano senza ricomprimerli (più veloce).
      zip.file(zipPath.get(d.id), blob, { binary: true, compression: 'STORE', date: new Date(d.created_at || Date.now()) });
    } catch (e) {
      console.error(e);
      failed.push(zipPath.get(d.id));
    }
  }
  if (failed.length) zip.file('FILE-MANCANTI.txt', `File che non è stato possibile scaricare:\r\n${failed.join('\r\n')}\r\n`);

  const zipProgress = (meta) => onProgress({ phase: 'zip', done: 0, total: 0, percent: 80 + meta.percent * 0.2, text: 'Creazione del file zip…' });
  if (writable) {
    await new Promise((resolve, reject) => {
      const stream = zip.generateInternalStream({ type: 'uint8array', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 6 } });
      let chain = Promise.resolve();
      stream.on('data', (chunk, meta) => {
        // si mette in pausa finché il pezzo non è scritto su disco (memoria sempre bassa)
        stream.pause();
        chain = chain.then(() => writable.write(chunk)).then(() => stream.resume(), (e) => { reject(e); });
        zipProgress(meta);
      });
      stream.on('error', reject);
      stream.on('end', () => chain.then(resolve, reject));
      stream.resume();
    });
    await writable.close();
  } else {
    const blob = await zip.generateAsync({ type: 'blob', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 6 } }, zipProgress);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  onProgress({ phase: 'done', done: docs.length, total: docs.length, percent: 100, text: 'Backup completato.' });
  return { files: docs.length, failed, savedAs: writable ? 'disco' : 'download' };
}
