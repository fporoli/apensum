// Apensum's service worker: makes the web app installable (a PWA) and quick to start. It caches
// only the app itself (index.html and the built assets), never API answers: those come from the
// API's own origin and always go to the network, so nobody sees stale or someone else's data.
//
//  - index.html (navigations): network first, the cached copy only when offline, so a deploy is
//    picked up on the next start.
//  - /assets/* (hashed file names) and icons: served from the cache, refreshed in the background
//    (the container writes its runtime config into the JS at start, so a file can change under the
//    same name).
const CACHE = 'apensum-app-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/', '/manifest.webmanifest'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const fresh = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        if (cached) {
          event.waitUntil(fresh);
          return cached;
        }
        return fresh;
      }),
    );
  }
});
