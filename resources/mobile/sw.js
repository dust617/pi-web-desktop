// Service worker with self-updating shell.
//
// HOW UPDATES REACH THE PHONE WITHOUT CLEARING CACHE:
//  1. Bump VERSION here AND PWA_VERSION in index.html on every deploy.
//  2. sw.js is served with `Cache-Control: no-store`, so the browser always
//     fetches the newest sw.js (Cloudflare must NOT cache it — see cache rule).
//  3. On install we skipWaiting(); on activate we claim() all open pages and
//     postMessage the new VERSION to every client.
//  4. index.html compares the posted VERSION to its baked-in PWA_VERSION and
//     reloads once if they differ — picking up the new shell automatically.
//
// API/auth/SSE are never intercepted. Offline launch still works from cache.
const VERSION = "pi-mobile-v4";
const CACHE_NAME = VERSION;
const SHELL_URLS = ["/mobile/", "/mobile/index.html", "/mobile/manifest.json"];

self.addEventListener("install", (event) => {
  // Activate immediately instead of waiting for old tabs/pages to close.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop every old cache so stale shells are gone for good.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      // Take control of all currently-open pages right now.
      await self.clients.claim();
      // Tell every open page which version just took over so it can reload
      // itself if it is still running an older shell.
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: "sw-version", version: VERSION });
      }
    })()
  );
});

self.addEventListener("message", (event) => {
  // A page can ask which version is active (e.g. right after load).
  if (event.data === "get-version") {
    event.source.postMessage({ type: "sw-version", version: VERSION });
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never intercept API, auth, or SSE — those must always hit the network.
  if (url.pathname.startsWith("/mobile/api/") || url.pathname.startsWith("/mobile/auth/")) {
    return;
  }
  // Everything else under /mobile/: network-first with cache fallback so the
  // latest shell loads online, and the app still launches offline.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
