const CACHE_PREFIX = 'ro-vocab-pwa-';
const CACHE_NAME = 'ro-vocab-pwa-v54-learning-review';
const APP_SHELL_PATHS = [
  './',
  './index.html',
  './scheduler.js',
  './learning-evidence.js',
  './content-quality.js',
  './study-session.js',
  './study-session-ui.js',
  './content-quality-ui.js',
  './progress-model.js',
  './daily-plan.js',
  './taxonomy.js',
  './romanian-text.js',
  './quiz-engine.js',
  './api.js',
  './telemetry.js',
  './auth.js',
  './app.js',
  './pwa.js',
  './data/vocab.json',
  './data/examples.json',
  './data/grammar-courses.json',
  './data/grammar-content.json',
  './manifest.webmanifest',
  './manifest/icon-192.png',
  './manifest/icon-512.png',
  './manifest/apple-touch-icon.png'
];
// Packaged web/APK builds supply this file; source-only previews use a CDN.
const OPTIONAL_SHELL_PATHS = ['./vendor/supabase.js'];
const CACHED_PATHS = new Set([...APP_SHELL_PATHS, ...OPTIONAL_SHELL_PATHS]
  .map(path => new URL(path, self.registration.scope).pathname));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL_PATHS);
    await Promise.all(OPTIONAL_SHELL_PATHS.map(path => cache.add(path).catch(() => {})));
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, event) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
    else {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
    }
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

  if (event.request.mode === 'navigate' || CACHED_PATHS.has(url.pathname)) {
    event.respondWith(networkFirst(event.request, event));
    return;
  }

  event.respondWith(fetch(event.request));
});
