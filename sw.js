const CACHE_NAME = 'ro-vocab-pwa-v9';
const CACHE_FIRST_PATHS = [
  '/data/vocab.json',
  '/data/examples.json'
];

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
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (!CACHE_FIRST_PATHS.includes(url.pathname)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;

    const response = await fetch(event.request);
    if (response.ok) cache.put(event.request, response.clone());
    return response;
  })());
});
