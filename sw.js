// Rands service worker: makes the app open offline.
// Bump CACHE when you change files so phones pick up the new version.
const CACHE = 'rands-v2';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './vault.js', './importer.js', './manifest.json',
  './icon-180.png', './icon-192.png', './icon-512.png', './fflate.mjs', './pdf.min.mjs', './pdf.worker.min.mjs'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// Network first (so updates arrive quickly), cache as offline fallback.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
