/**
 * storage.js — UNICO punto di accesso ai file (Supabase Storage + cache locale delle miniature).
 *
 * Tutto il resto dell'app chiede i file solo a questo modulo: in futuro una vera
 * modalità offline potrà essere aggiunta qui senza toccare le altre parti.
 *
 * Percorsi nel bucket privato:  <user_id>/<document_id>/<nome-file>
 * Le miniature sono salvate anche nel browser (Cache API, chiave = percorso del file):
 * dato che ogni nuova versione di un file ha un nome nuovo, la cache non diventa mai "vecchia".
 */
import { BUCKET, KEYS, SIGNED_URL } from './config.js';
import { sb } from './sb.js';

let userId = null;
export function setStorageUser(id) { userId = id; }

function bucket() { return sb().storage.from(BUCKET); }

/* ----------------------------------------------------------------- percorsi */

/** Percorsi per una nuova versione dei file di un documento. */
export function makePaths(docId, ext) {
  if (!userId) throw new Error('Utente non collegato.');
  const v = Date.now().toString(36);
  return {
    file: `${userId}/${docId}/file-${v}.${ext}`,
    thumb: `${userId}/${docId}/thumb-${v}.webp`,
  };
}

/* ----------------------------------------------------------------- scrittura */

export async function uploadFile(path, blob, contentType) {
  const { error } = await bucket().upload(path, blob, {
    contentType: contentType || blob.type || 'application/octet-stream',
    cacheControl: '31536000', // il nome cambia a ogni versione: si può tenere in cache a lungo
    upsert: false,
  });
  if (error) throw error;
}

/** Elimina definitivamente dei file (ignora i percorsi vuoti). */
export async function removeFiles(paths) {
  const list = [...new Set(paths.filter(Boolean))];
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const { error } = await bucket().remove(chunk);
    if (error) throw error;
    chunk.forEach(forgetPath);
  }
  await dropThumbs(list);
}

/* ----------------------------------------------------------------- URL firmati */

/** path -> { url, expiresAt (ms) } */
const signed = new Map();
/** Richieste in attesa di essere raggruppate: path -> [{resolve, reject}] */
let pending = new Map();
let flushTimer = null;

function validSigned(path) {
  const s = signed.get(path);
  return s && s.expiresAt - SIGNED_URL.renewBeforeSec * 1000 > Date.now() ? s.url : null;
}

/**
 * URL firmato (temporaneo) di un file. Le richieste ravvicinate vengono raggruppate
 * in un'unica chiamata createSignedUrls; gli URL scaduti o in scadenza vengono rinnovati.
 */
export function signedUrl(path) {
  if (!path) return Promise.resolve(null);
  const ok = validSigned(path);
  if (ok) return Promise.resolve(ok);
  return new Promise((resolve, reject) => {
    if (!pending.has(path)) pending.set(path, []);
    pending.get(path).push({ resolve, reject });
    if (!flushTimer) flushTimer = setTimeout(flushSigned, 15);
  });
}

async function flushSigned() {
  flushTimer = null;
  const batch = pending; pending = new Map();
  const paths = [...batch.keys()];
  for (let i = 0; i < paths.length; i += SIGNED_URL.batchSize) {
    const chunk = paths.slice(i, i + SIGNED_URL.batchSize);
    try {
      const { data, error } = await bucket().createSignedUrls(chunk, SIGNED_URL.ttl);
      if (error) throw error;
      const expiresAt = Date.now() + SIGNED_URL.ttl * 1000;
      const byPath = new Map((data || []).map((d) => [d.path, d]));
      chunk.forEach((p) => {
        const d = byPath.get(p);
        const waiters = batch.get(p) || [];
        if (d && d.signedUrl && !d.error) {
          signed.set(p, { url: d.signedUrl, expiresAt });
          waiters.forEach((w) => w.resolve(d.signedUrl));
        } else {
          waiters.forEach((w) => w.reject(new Error(`File non trovato nello spazio di archiviazione (${p}).`)));
        }
      });
    } catch (e) {
      chunk.forEach((p) => (batch.get(p) || []).forEach((w) => w.reject(e)));
    }
  }
}

/** Dimentica l'URL firmato di un file e ne chiede uno nuovo (es. dopo un errore di caricamento). */
export function refreshSignedUrl(path) {
  signed.delete(path);
  return signedUrl(path);
}

/** Contenuto di un file (ArrayBuffer) tramite URL firmato, con una piccola memoria per prec./succ. */
const bufferCache = new Map();
export async function fileArrayBuffer(path) {
  if (bufferCache.has(path)) {
    const v = bufferCache.get(path); bufferCache.delete(path); bufferCache.set(path, v);
    return v;
  }
  const p = (async () => {
    let url = await signedUrl(path);
    let res = await fetch(url, { referrerPolicy: 'no-referrer' });
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      url = await refreshSignedUrl(path);
      res = await fetch(url, { referrerPolicy: 'no-referrer' });
    }
    if (!res.ok) throw new Error(`File non disponibile (${res.status}).`);
    return res.arrayBuffer();
  })();
  bufferCache.set(path, p);
  p.catch(() => bufferCache.delete(path));
  while (bufferCache.size > 4) bufferCache.delete(bufferCache.keys().next().value);
  return p;
}

/** Scarica un file come Blob (per PDF, modifiche e backup). */
export async function downloadBlob(path) {
  const { data, error } = await bucket().download(path);
  if (error) throw error;
  return data;
}

/* ----------------------------------------------------------------- miniature */

/** path -> object URL già pronto */
const thumbObjectUrls = new Map();
const thumbInflight = new Map();

function cacheKey(path) {
  // Chiave sintetica: non viene mai richiesta in rete, serve solo come etichetta nella Cache API.
  return new URL(`__tabshelf-thumb/${encodeURIComponent(path)}`, location.href).href;
}

async function openThumbCache() {
  if (!('caches' in window)) return null;
  try { return await caches.open(KEYS.thumbCache); } catch { return null; }
}

/** URL utilizzabile in <img> per una miniatura (cache locale, poi rete). */
export function thumbUrl(path) {
  if (!path) return Promise.resolve(null);
  if (thumbObjectUrls.has(path)) return Promise.resolve(thumbObjectUrls.get(path));
  if (thumbInflight.has(path)) return thumbInflight.get(path);
  const p = (async () => {
    const cache = await openThumbCache();
    let blob = null;
    if (cache) {
      const hit = await cache.match(cacheKey(path));
      if (hit) blob = await hit.blob();
    }
    if (!blob) {
      const url = await signedUrl(path);
      const res = await fetch(url, { referrerPolicy: 'no-referrer' });
      if (!res.ok) throw new Error('Miniatura non disponibile.');
      blob = await res.blob();
      if (cache) await cache.put(cacheKey(path), new Response(blob, { headers: { 'Content-Type': blob.type || 'image/webp' } })).catch(() => {});
    }
    const objUrl = URL.createObjectURL(blob);
    thumbObjectUrls.set(path, objUrl);
    return objUrl;
  })().finally(() => thumbInflight.delete(path));
  thumbInflight.set(path, p);
  return p;
}

/** Salva subito una miniatura appena creata (evita di riscaricarla). */
export async function primeThumb(path, blob) {
  const cache = await openThumbCache();
  if (cache) await cache.put(cacheKey(path), new Response(blob, { headers: { 'Content-Type': blob.type || 'image/webp' } })).catch(() => {});
}

function forgetPath(path) {
  signed.delete(path);
  const u = thumbObjectUrls.get(path);
  if (u) { URL.revokeObjectURL(u); thumbObjectUrls.delete(path); }
}

async function dropThumbs(paths) {
  const cache = await openThumbCache();
  if (!cache) return;
  await Promise.all(paths.map((p) => cache.delete(cacheKey(p)).catch(() => {})));
}

/** Svuota la cache locale delle miniature (impostazioni / uscita). */
export async function clearLocalCache() {
  thumbObjectUrls.forEach((u) => URL.revokeObjectURL(u));
  thumbObjectUrls.clear();
  signed.clear();
  if ('caches' in window) await caches.delete(KEYS.thumbCache).catch(() => {});
}

/** Spazio usato dalla cache locale delle miniature (stima). */
export async function localCacheInfo() {
  const cache = await openThumbCache();
  if (!cache) return { count: 0 };
  const keys = await cache.keys();
  return { count: keys.length };
}

/* ----------------------------------------------------------------- verifica */

/**
 * Prova completa dello spazio file: carica, firma, legge ed elimina una minuscola immagine di prova.
 * Lancia un errore se qualcosa non va.
 */
export async function storageSelfTest() {
  const path = `${userId}/_verifica/prova-${Date.now()}.png`;
  const c = document.createElement('canvas'); c.width = 2; c.height = 2;
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const { error: upErr } = await bucket().upload(path, blob, { contentType: 'image/png', upsert: false });
  if (upErr) throw upErr;
  try {
    const { data, error } = await bucket().createSignedUrls([path], 60);
    if (error || !data?.[0]?.signedUrl) throw error || new Error('URL firmato non ottenuto.');
    const res = await fetch(data[0].signedUrl);
    if (!res.ok) throw new Error(`Lettura non riuscita (${res.status}).`);
  } finally {
    await bucket().remove([path]);
  }
  return 'ok';
}
