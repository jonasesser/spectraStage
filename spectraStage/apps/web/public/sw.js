/* SpectraStage service worker: keeps the renderer runnable during internet outages.
 * - Precaches the whole build (asset-manifest.json) so a reload without internet still works
 *   if the files were cached before.
 * - Navigation: network first, cached app shell as fallback.
 * - Hashed assets: cache first.
 * - API and WebSocket traffic are never cached.
 */
const CACHE_PREFIX = 'spectrastage-';

async function currentManifest() {
  const res = await fetch('/asset-manifest.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('manifest');
  return res.json();
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const manifest = await currentManifest();
        const cache = await caches.open(CACHE_PREFIX + manifest.version);
        await cache.addAll(manifest.files);
        await self.clients.matchAll().then(() => undefined);
      } catch {
        /* offline install – will retry next time */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const manifest = await currentManifest();
        const keep = CACHE_PREFIX + manifest.version;
        for (const key of await caches.keys()) {
          if (key.startsWith(CACHE_PREFIX) && key !== keep) await caches.delete(key);
        }
      } catch {
        /* keep old caches while offline */
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          return res;
        } catch {
          const cached = (await caches.match('/')) || (await caches.match('/index.html'));
          return cached || new Response('Offline', { status: 503 });
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok) {
          const keys = await caches.keys();
          const name = keys.filter((k) => k.startsWith(CACHE_PREFIX)).pop();
          if (name) (await caches.open(name)).put(req, res.clone());
        }
        return res;
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      try {
        return await fetch(req);
      } catch {
        const cached = await caches.match(req);
        return cached || new Response('', { status: 504 });
      }
    })(),
  );
});
