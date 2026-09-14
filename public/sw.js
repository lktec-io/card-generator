/* Cardhub Digital Invitation — service worker
 *
 * Kept deliberately conservative for a live system:
 *  • /api/*, /generated/*, non-GET requests, range requests and other origins are never
 *    intercepted — login, check-in, RSVP and uploads always go straight to the network.
 *  • Page loads are network-first: a new deploy shows up immediately; the cached app shell
 *    is only used when the device is offline.
 *  • /assets/* files are content-hashed by Vite, so answering them from cache is always safe.
 *
 * To wipe every cache on the next visit, bump VERSION.
 */
const VERSION       = 'v1';
const SHELL_CACHE   = `cardhub-shell-${VERSION}`;
const ASSET_CACHE   = `cardhub-assets-${VERSION}`;
const RUNTIME_CACHE = `cardhub-runtime-${VERSION}`;
const OUR_CACHES    = [SHELL_CACHE, ASSET_CACHE, RUNTIME_CACHE];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png']))
      .catch(() => { /* offline while installing — pages still load from the network */ })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('cardhub-') && !OUR_CACHES.includes(key))
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/generated/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(pageNetworkFirst(event));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(event, ASSET_CACHE, 60));
  } else {
    event.respondWith(networkFirst(event, RUNTIME_CACHE, 40));
  }
});

const cacheable = (response) => Boolean(response && response.ok && response.type === 'basic');

async function pageNetworkFirst(event) {
  try {
    const response = await fetch(event.request);
    const isHtml = (response.headers.get('content-type') || '').includes('text/html');
    if (cacheable(response) && isHtml) {
      // Every route serves the same single-page app shell, so keep the latest copy under '/'
      const copy = response.clone();
      event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy)));
    }
    return response;
  } catch {
    const shell = await caches.match('/', { cacheName: SHELL_CACHE });
    return shell || new Response('You are offline. Reconnect and try again.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function cacheFirst(event, cacheName, maxEntries) {
  const cached = await caches.match(event.request, { cacheName });
  if (cached) return cached;

  const response = await fetch(event.request);
  if (cacheable(response)) {
    const copy = response.clone();
    event.waitUntil(
      caches.open(cacheName)
        .then((cache) => cache.put(event.request, copy))
        .then(() => trim(cacheName, maxEntries)),
    );
  }
  return response;
}

async function networkFirst(event, cacheName, maxEntries) {
  try {
    const response = await fetch(event.request);
    if (cacheable(response)) {
      const copy = response.clone();
      event.waitUntil(
        caches.open(cacheName)
          .then((cache) => cache.put(event.request, copy))
          .then(() => trim(cacheName, maxEntries)),
      );
    }
    return response;
  } catch (error) {
    const cached = await caches.match(event.request, { cacheName });
    if (cached) return cached;
    throw error;
  }
}

async function trim(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const excess = keys.slice(0, Math.max(0, keys.length - maxEntries));
  await Promise.all(excess.map((key) => cache.delete(key)));
}
