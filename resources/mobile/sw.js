// Service worker with self-updating shell.
//
// HOW UPDATES REACH THE PHONE WITHOUT CLEARING CACHE:
//  1. Bump VERSION here AND PWA_VERSION in index.html on every deploy.
//  2. sw.js is served with `Cache-Control: no-store`, so the browser always
//     fetches the newest sw.js (Cloudflare must NOT cache it — see cache rule).
//  3. On install we skipWaiting(); on activate we claim() all open pages.
//  4. Open pages are never force-reloaded; the next cold launch gets the new
//     network-first shell while an active chat remains undisturbed.
//
// API/auth/SSE are never intercepted. Offline launch still works from cache.
const VERSION = "pi-mobile-v31";
const CACHE_NAME = VERSION;
const SHELL_URLS = ["/mobile/", "/mobile/index.html", "/mobile/manifest.json"];

self.addEventListener("install", (event) => {
  // Activate immediately instead of waiting for old tabs/pages to close.
  self.skipWaiting();
  // Do not swallow pre-cache failures: if any shell request fails, installation
  // must fail so the previous working worker/cache remains intact.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
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
      // NOTE: we deliberately do NOT broadcast sw-version here. The old design
      // made open pages reload themselves on a new shell, but a mid-session
      // reload wipes all in-memory chat state and drops the user back to the
      // project list — the "auto-refresh / dropped and re-entered" instability.
      // The shell is network-first + no-store, so the NEXT cold launch serves
      // the fresh shell with zero cache clearing; no hot reload is needed.
      // Silencing the broadcast also means an already-open OLD page never even
      // learns a new version exists, so it won't reload either — it just keeps
      // running quietly until the user next reopens the app.
    })()
  );
});

self.addEventListener("message", (event) => {
  // A page can ask which version is active (e.g. right after load).
  if (event.data === "get-version" && event.source?.postMessage) {
    event.source.postMessage({ type: "sw-version", version: VERSION });
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never intercept cross-origin requests, mutations, API, auth, or SSE.
  if (url.origin !== self.location.origin || event.request.method !== "GET" ||
      !url.pathname.startsWith("/mobile/") ||
      url.pathname.startsWith("/mobile/api/") || url.pathname.startsWith("/mobile/auth/")) {
    return;
  }

  // A half-open mobile link may never reject fetch(). Bound network-first so an
  // already-cached shell opens promptly instead of showing a blank screen.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  event.respondWith(
    fetch(event.request, { signal: controller.signal })
      .then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(async () => (await caches.match(event.request)) || Response.error())
      .finally(() => clearTimeout(timer))
  );
});
