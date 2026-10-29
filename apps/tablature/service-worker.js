/**
 * service-worker.js — Funzionamento offline e ricezione dei file condivisi.
 *
 * Versione per la dashboard: l'app vive in apps/tablature/ e il service worker
 * controlla SOLO quella cartella. Gestisce e cancella soltanto le proprie cache
 * (prefisso "gtl-"), senza toccare quelle delle altre app dello stesso dominio.
 *
 * Strategia:
 *  - file dell'app: pre-cache in una cache versionata, poi cache-first;
 *  - librerie da CDN (jsDelivr, versioni bloccate): pre-cache tollerante + cache-first,
 *    così dopo il primo avvio online l'app funziona anche offline;
 *  - navigazioni: index.html dalla cache, offline.html come ultima risorsa.
 *
 * IMPORTANTE: per pubblicare un aggiornamento incrementare CACHE_VERSION.
 * Il database (IndexedDB) NON viene toccato dagli aggiornamenti.
 */
const CACHE_PREFIX = 'gtl-';
const CACHE_VERSION = 'gtl-v1.0.0';
const SHARE_CACHE = 'gtl-share-inbox';

/** File indispensabili: se uno manca l'installazione fallisce (meglio che un'app offline a metà). */
const CORE_ASSETS = [
  './',
  './index.html',
  './offline.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './js/utils.js',
  './js/db.js',
  './js/store.js',
  './js/ui.js',
  './js/images.js',
  './js/categories.js',
  './js/tabform.js',
  './js/pdfimport.js',
  './js/archive.js',
  './js/viewer.js',
  './js/practice.js',
  './js/backup.js',
  './js/pdfexport.js',
];

/** File facoltativi: se mancano (es. icone PNG non ancora caricate) l'installazione prosegue. */
const OPTIONAL_ASSETS = [
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

/** Librerie esterne con versione bloccata (devono coincidere con index.html e js/pdfimport.js). */
const CDN_ORIGIN = 'https://cdn.jsdelivr.net';
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/build/pdf.min.mjs',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/build/pdf.worker.min.mjs',
];

/** Salva un elenco di URL ignorando i singoli errori. */
async function cacheTolerant(cache, urls, init = {}) {
  await Promise.all(urls.map(async (url) => {
    try {
      const res = await fetch(new Request(url, init));
      if (res.ok) await cache.put(url, res);
    } catch { /* risorsa non disponibile ora: verrà salvata al primo utilizzo */ }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // cache: 'reload' evita di salvare versioni vecchie dalla cache HTTP
    await cache.addAll(CORE_ASSETS.map((u) => new Request(u, { cache: 'reload' })));
    await cacheTolerant(cache, OPTIONAL_ASSETS, { cache: 'reload' });
    await cacheTolerant(cache, CDN_ASSETS, { mode: 'cors', credentials: 'omit' });
    // Al primo avvio si attiva subito; negli aggiornamenti attende la conferma dell'utente.
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Solo le cache di QUESTA app (prefisso gtl-), mai quelle delle altre app della dashboard.
    await Promise.all(keys
      .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_VERSION && k !== SHARE_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Web Share Target (Android, PWA installata): salva i file e reindirizza all'app.
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(handleShare(req));
    return;
  }
  if (req.method !== 'GET') return;

  // Librerie da CDN: cache-first, salvate al primo utilizzo se non già in cache.
  if (url.origin === CDN_ORIGIN) {
    event.respondWith(cacheFirst(req, true));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Navigazioni: app shell dalla cache
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match('./index.html');
      if (cached) return cached;
      try { return await fetch(req); } catch { return (await cache.match('./offline.html')) || Response.error(); }
    })());
    return;
  }

  // Risorse statiche dell'app: cache-first, poi rete
  event.respondWith(cacheFirst(req, false));
});

/** Cache-first con salvataggio in cache delle risposte valide. */
async function cacheFirst(req, external) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(req, { ignoreSearch: !external, ignoreVary: true });
  if (cached) return cached;
  try {
    const res = await fetch(req);
    const cacheable = external ? (res.ok && (res.type === 'cors' || res.type === 'basic')) : (res.ok && res.type === 'basic');
    if (cacheable) cache.put(req, res.clone());
    return res;
  } catch {
    return new Response('Risorsa non disponibile offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function handleShare(request) {
  const base = new URL('./', self.registration.scope).href;
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter((f) => f && typeof f === 'object' && f.size);
    const cache = await caches.open(SHARE_CACHE);
    let i = 0;
    for (const f of files) {
      await cache.put(new Request(`${base}__shared/${Date.now()}-${i++}`), new Response(f, {
        headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name || 'condivisa') },
      }));
    }
    return Response.redirect(`${base}index.html?share=1#/archivio`, 303);
  } catch {
    return Response.redirect(`${base}index.html?share=error#/archivio`, 303);
  }
}
