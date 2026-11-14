/**
 * service-worker.js — TabShelf
 *
 * Gestisce SOLO i file dell'app (HTML, CSS, JS, icone) e le librerie da jsDelivr
 * con versione bloccata. NON tocca mai i dati né i file su Supabase: quelle
 * richieste passano direttamente alla rete.
 *
 * Strategia:
 *  - file dell'app: prima la rete (così ogni modifica pubblicata si vede subito),
 *    la copia in cache serve solo se la rete non risponde;
 *  - librerie jsDelivr (URL con versione bloccata, non cambiano mai): prima la cache.
 *
 * CACHE_VERSION: incrementala quando cambi l'elenco dei file qui sotto o vuoi
 * forzare il rinnovo della copia di riserva. Le cache dell'app usano il prefisso
 * "tabshelf-app-"; all'attivazione vengono cancellate solo quelle vecchie con questo
 * prefisso (mai le cache delle altre app, né la cache delle miniature "tabshelf-thumbs-…").
 */
const CACHE_VERSION = 'tabshelf-app-v5';
const APP_CACHE_PREFIX = 'tabshelf-app-';

const CORE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './js/config.js',
  './js/util.js',
  './js/ui.js',
  './js/connection.js',
  './js/sb.js',
  './js/storage.js',
  './js/store.js',
  './js/actions.js',
  './js/images.js',
  './js/pdf.js',
  './js/tagpicker.js',
  './js/filter.js',
  './js/docgrid.js',
  './js/bulk.js',
  './js/viewer.js',
  './js/backup.js',
  './js/views/visualizza.js',
  './js/views/settings.js',
  './js/views/library.js',
  './js/views/docsheet.js',
  './js/views/upload.js',
  './js/views/tags.js',
  './js/views/trash.js',
  '../../assets/css/app-nav.css',
];

/** Librerie esterne ammesse in cache (devono avere la versione nell'indirizzo). */
const CDN_PREFIXES = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@',
  'https://cdn.jsdelivr.net/npm/jszip@',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@',
];

const SCOPE_PATH = new URL('./', self.location).pathname;
const SHARED_CSS = new URL('../../assets/css/app-nav.css', self.location).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.all(CORE.map(async (u) => {
      try {
        const res = await fetch(new Request(u, { cache: 'reload' }));
        if (res.ok) await cache.put(u, res);
      } catch { /* verrà salvato al primo utilizzo */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith(APP_CACHE_PREFIX) && k !== CACHE_VERSION)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (CDN_PREFIXES.some((p) => req.url.startsWith(p))) {
    event.respondWith(cacheFirst(req));
    return;
  }
  const isApp = url.origin === self.location.origin
    && (url.pathname.startsWith(SCOPE_PATH) || url.href === SHARED_CSS);
  if (!isApp) return; // Supabase e tutto il resto: nessun intervento

  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('TabShelf non è raggiungibile: controlla la connessione.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && (res.type === 'cors' || res.type === 'basic')) cache.put(req, res.clone());
  return res;
}
