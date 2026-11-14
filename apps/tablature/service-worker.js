/**
 * service-worker.js — "spegnimento" della vecchia Guitar Tab Library.
 *
 * La vecchia app registrava un service worker (cache-first) in questa cartella.
 * Il browser controlla periodicamente questo file: trovandolo cambiato installa
 * questa versione, che:
 *   1. si attiva subito (skipWaiting) senza aspettare la chiusura delle schede;
 *   2. cancella tutte le cache con prefisso "gtl-" (mai quelle delle altre app);
 *   3. si deregistra;
 *   4. ricarica le schede aperte, che così ricevono dalla rete il reindirizzamento a TabShelf.
 * Non intercetta più nessuna richiesta (nessun gestore "fetch").
 * I dati della vecchia app in IndexedDB non vengono toccati.
 */
self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('gtl-')).map((k) => caches.delete(k)));
    await self.clients.claim();
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await self.registration.unregister();
    await Promise.all(windows.map((c) => (c.navigate ? c.navigate(c.url).catch(() => {}) : null)));
  })());
});
