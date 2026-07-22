// Service worker: keep the app shell fresh (network-first) so UI fixes reach
// the phone on refresh, while still allowing offline launch from cache.
// API/auth/SSE are never intercepted. Bump CACHE_NAME to invalidate old shells.
const CACHE_NAME = "pi-mobile-v2";
const SHELL_URLS = ["/mobile/", "/mobile/index.html", "/mobile/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never intercept API, auth, or SSE
  if (url.pathname.startsWith("/mobile/api/") || url.pathname.startsWith("/mobile/auth/")) {
    return;
  }
  // Shell: network-first with cache fallback (always get the latest online,
  // fall back to cache only when offline).
  if (url.pathname === "/mobile/" || url.pathname === "/mobile/index.html" || url.pathname === "/mobile/manifest.json") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
  // Other static assets: network-first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
