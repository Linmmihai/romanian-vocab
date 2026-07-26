const CACHE_NAME = 'ro-vocab-pwa-v35';
const APP_SHELL_PATHS = [
  './',
  './index.html',
  './scheduler.js',
  './progress-model.js',
  './daily-plan.js',
  './taxonomy.js',
  './romanian-text.js',
  './api.js',
  './telemetry.js',
  './auth.js',
  './app.js',
  './pwa.js',
  './data/grammar-courses.json',
  './data/grammar-content.json',
  './manifest.webmanifest',
  './manifest/icon-192.png',
  './manifest/icon-512.png',
  './manifest/apple-touch-icon.png'
];
const DATA_PATHS = new Set([
  '/data/vocab.json',
  '/data/examples.json',
  '/data/grammar-courses.json',
  '/data/grammar-content.json'
]);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL_PATHS);
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html', { ignoreSearch: true });
      if (shell) return shell;
    }
    throw error;
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === 'navigate' || DATA_PATHS.has(url.pathname) || APP_SHELL_PATHS.some(path => url.pathname === new URL(path, self.location.href).pathname)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(fetch(event.request));
});
