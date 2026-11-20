// Service worker: makes repeat visits fast on a static host that sets almost no
// cache headers.
//
//   documents  -> network first, cache fallback (pages never go stale)
//   assets     -> stale-while-revalidate (instant paint, refreshed in the
//                 background; every module is versioned with ?v= so a bump is
//                 a new URL and never served from an old entry)
//   everything else (cross-origin, non-GET, ranged) -> untouched, so the
//                 comment backend and its POSTs behave exactly as before.

const CACHE = "espl-static-v1";
const ASSET = /\.(?:m?js|css|json|csv|png|jpe?g|webp|gif|svg|ico|woff2?|glb|gltf|hdr|txt)$/i;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || network;
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/sw.js")) return;
  if (request.headers.has("range")) return;

  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(networkFirst(request));
    return;
  }
  if (!ASSET.test(url.pathname)) return;
  event.respondWith(staleWhileRevalidate(request));
});
