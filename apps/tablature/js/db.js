/**
 * db.js — Accesso a IndexedDB.
 *
 * Object store:
 *  - tabs        : metadati delle tablature (nessun blob)
 *  - images      : blob delle immagini { id, tabId, kind: 'full'|'thumb'|'original', blob, mime, width, height, size }
 *  - categories  : categorie gerarchiche
 *  - settings    : coppie { key, value }
 *
 * Le immagini sono separate dai metadati: l'archivio carica in memoria solo i
 * metadati e richiede i blob soltanto quando servono (miniature/visualizzatore).
 */

export const DB_NAME = 'guitar-tab-library';
/** Versione dello schema IndexedDB. Incrementare e aggiungere uno step in migrate(). */
export const DB_VERSION = 1;
/** Versione del formato dati (salvata anche nei backup). */
export const DATA_SCHEMA_VERSION = 1;

const STORES = ['tabs', 'images', 'categories', 'settings'];
let dbPromise = null;

/** Migrazioni progressive dello schema. */
function migrate(db, oldVersion, tx) {
  if (oldVersion < 1) {
    const tabs = db.createObjectStore('tabs', { keyPath: 'id' });
    tabs.createIndex('createdAt', 'createdAt');
    tabs.createIndex('updatedAt', 'updatedAt');
    const images = db.createObjectStore('images', { keyPath: 'id' });
    images.createIndex('tabId', 'tabId');
    const cats = db.createObjectStore('categories', { keyPath: 'id' });
    cats.createIndex('parentId', 'parentId');
    db.createObjectStore('settings', { keyPath: 'key' });
  }
  // Esempio per il futuro:
  // if (oldVersion < 2) { tx.objectStore('tabs').createIndex('favorite', 'favorite'); }
}

/** Apre (una sola volta) il database. */
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('Questo browser non supporta IndexedDB: impossibile salvare le tablature.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => migrate(req.result, e.oldVersion, req.transaction);
    req.onsuccess = () => {
      const db = req.result;
      // Se un'altra scheda aggiorna lo schema, chiudiamo per non bloccarla.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('Impossibile aprire il database locale.'));
    req.onblocked = () => reject(new Error('Database bloccato da un\'altra scheda aperta dell\'app. Chiudi le altre schede e ricarica.'));
  });
  return dbPromise;
}

/** Promessa che si risolve al completamento della transazione. */
function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new DOMException('Transazione annullata', 'AbortError'));
  });
}

const reqP = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** Legge tutti i record di uno store. */
export async function getAll(store) {
  const db = await openDB();
  const tx = db.transaction(store, 'readonly');
  return reqP(tx.objectStore(store).getAll());
}

/** Legge un record per chiave. */
export async function get(store, key) {
  const db = await openDB();
  const tx = db.transaction(store, 'readonly');
  return reqP(tx.objectStore(store).get(key));
}

/** Inserisce/aggiorna più record di uno o più store in un'unica transazione atomica.
 *  ops: [{ store, put: [records] }, { store, del: [keys] }] */
export async function batch(ops) {
  const db = await openDB();
  const storeNames = [...new Set(ops.map((o) => o.store))];
  const tx = db.transaction(storeNames, 'readwrite');
  for (const op of ops) {
    const os = tx.objectStore(op.store);
    if (op.clear) os.clear();
    (op.put || []).forEach((r) => os.put(r));
    (op.del || []).forEach((k) => os.delete(k));
  }
  return done(tx);
}

export const put = (store, record) => batch([{ store, put: [record] }]);
export const del = (store, key) => batch([{ store, del: [key] }]);

/** Recupera i record immagine di una tablatura. */
export async function getImagesByTab(tabId) {
  const db = await openDB();
  const tx = db.transaction('images', 'readonly');
  return reqP(tx.objectStore('images').index('tabId').getAll(tabId));
}

/** Elenca le sole chiavi dello store immagini (senza caricare i blob). */
export async function getImageKeys() {
  const db = await openDB();
  const tx = db.transaction('images', 'readonly');
  return reqP(tx.objectStore('images').getAllKeys());
}

/** Itera le immagini una per volta (evita di caricare tutti i blob insieme). */
export async function forEachImage(callback) {
  const keys = await getImageKeys();
  for (const key of keys) {
    const rec = await get('images', key);
    if (rec) await callback(rec);
  }
}

/** Impostazioni: lettura con default. */
export async function getSetting(key, fallback = null) {
  try {
    const rec = await get('settings', key);
    return rec ? rec.value : fallback;
  } catch { return fallback; }
}
export const setSetting = (key, value) => put('settings', { key, value });

/** Svuota completamente tutti gli store in una transazione (usato dal ripristino). */
export async function clearAll() {
  return batch(STORES.map((store) => ({ store, clear: true })));
}

/** Stima dello spazio usato/disponibile. */
export async function storageEstimate() {
  if (navigator.storage && navigator.storage.estimate) {
    try { return await navigator.storage.estimate(); } catch { /* ignorato */ }
  }
  return null;
}

/** Richiede la persistenza dello storage (il browser non lo svuota automaticamente). */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* ignorato */ }
  return false;
}
