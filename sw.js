const CACHE = "mtng-forms-v11";
const ASSETS = ["./", "./index.html", "./app.js", "./db.js", "./sw.js", "./manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // ✅ Always pass-through cross-origin requests (Apps Script, Google, etc.)
  // This avoids caching bugs and opaque response issues.
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(req));
    return;
  }

  // ✅ For same-origin requests, use cache-first (app shell)
  event.respondWith((async () => {
    const cache = await caches.open("mtng-cache-v1");
    const cached = await cache.match(req);
    if (cached) return cached;

    try {
      const res = await fetch(req);
      // Only cache successful basic responses
      if (res && res.ok && res.type === "basic") {
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      // Offline fallback: if you have an offline page, serve it here.
      // Otherwise, rethrow to let browser handle it.
      throw err;
    }
  })());
});








