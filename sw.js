const CACHE = "mtng-forms-v14";
const CACHE_NAME = "mtng-v2026-02-14-1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});


// Include owner.html too so dashboard works offline for the shell
const ASSETS = [
  "./",
  "./index.html",
  "./owner.html",
  "./app.js",
  "./db.js",
  "./sw.js",
  "./manifest.json"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // Cleanup old caches
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // ✅ IMPORTANT: Never intercept cross-origin (Google Apps Script, Google Drive, etc.)
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(req).catch(() => new Response("", { status: 502 })));
    return;
  }

  // ✅ For navigation requests, serve cached shell first, then network
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        // keep latest HTML
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        // offline fallback to cached page
        return (await cache.match(req)) || (await cache.match("./index.html"));
      }
    })());
    return;
  }

  // ✅ For other same-origin assets: cache-first, then network
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;

    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === "basic") {
        cache.put(req, res.clone());
      }
      return res;
    } catch {
      // If offline and not cached
      return new Response("Offline", { status: 503, statusText: "Offline" });
    }
  })());
});


