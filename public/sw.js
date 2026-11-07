// Budget Up service worker: makes the app installable and lets the shell open offline.
// Network-first for app files (always fresh when online), cache fallback when offline. API calls are never cached.
const CACHE = 'budget-up-v1';
const SHELL = [
  '/', '/css/app.css', '/js/app.js', '/js/api.js', '/js/ui.js', '/js/state.js', '/js/views.js', '/js/settings.js',
  '/js/aggregate.js', '/manifest.webmanifest', '/icons/duck.svg', '/icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        // Navigations (/, /join/xyz) all share the cached app shell at '/'.
        caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? '/' : req, copy));
      }
      return res;
    }).catch(() => caches.match(req.mode === 'navigate' ? '/' : req).then((r) => r || Response.error()))
  );
});
