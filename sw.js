/* sw.js — Service Worker pro TČ Expert PRO (offline app-shell, plán #37/#42).
 *
 * Strategie:
 *  - Precache app shellu (same-origin soubory) při instalaci.
 *  - Navigace (HTML): network-first s fallbackem na cachovaný index.html
 *    (aby appka fungovala i offline po prvním online načtení).
 *  - Ostatní GET (vč. CDN Chart.js a fontů): cache-first, jinak síť +
 *    oportunistické uložení odpovědi do runtime cache. CDN se tak zachová
 *    pro offline až po prvním online načtení.
 *  - Ne-GET požadavky se neřeší (jen průchozí).
 */

const CACHE_VERSION = 'tc-expert-v1';
const SHELL_CACHE = CACHE_VERSION + '-shell';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

// Same-origin shell — relativní cesty vůči umístění sw.js.
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.error('SW install: precache selhal', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Navigace (otevření appky) — network-first, fallback na shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Ostatní GET — cache-first, jinak síť + oportunistické uložení.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Cachuj jen úspěšné odpovědi (basic/cors), ať nepleníme chyby.
        if (res && (res.status === 200 || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
    })
  );
});
