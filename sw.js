const CACHE_NAME = 'ro-vocab-pwa-v7';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const request = event.request.cache === 'only-if-cached'
    ? event.request
    : new Request(event.request, { cache: 'no-store' });
  event.respondWith(fetch(request));
});
