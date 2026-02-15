/* sw.js — MTNG Field Forms */

const CACHE_NAME = "mtng-v2026-02-14-1";

// Cache-bust JS by including version query in precache list.
// Make sure index.html uses the same versioned URL:
// <script type="module" src="./app.js?v=2026-02-14-1"></script>
const ASSETS = [
  "./",
  "./index.html",
  "./owner.html",
  "./app.js?v=2026-02-14-1",
  "./db.js",
  "./manifest.json",
  "./sw.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never intercept cross-origin (Google Apps Script, Drive, etc.)
  if (url.origin !== self.location.origin) return;

  // Navigation: network-first, fallback to cached shell
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req)) || (await cache.match("./index.html"));
      }
    })());
    return;
  }

  // Other assets: cache-first, then network, then offline response
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // normalize cache key for app.js?v=...
    const cached = await cache.match(req, { ignoreSearch: false });
    if (cached) return cached;

    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === "basic") {
        cache.put(req, res.clone());
      }
      return res;
    } catch {
      return new Response("Offline", { status: 503, statusText: "Offline" });
    }
  })());
});


