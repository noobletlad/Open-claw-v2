// OpenClaw AI — Service Worker v2.0
// Cache-first for assets, network-first for API calls

const CACHE_NAME = "openclaw-v2";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
];

// Install — cache static shell
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[OC:SW] Pre-caching shell");
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate — delete old caches
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => {
            console.log("[OC:SW] Deleting old cache:", k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
// - Anthropic API → network only (never cache API calls)
// - Everything else → stale-while-revalidate
self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Never intercept Anthropic API calls
  if (url.hostname === "api.anthropic.com") {
    return; // fall through to network
  }

  // For navigation requests (HTML pages) — network first, fallback to cache
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return res;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Static assets — stale-while-revalidate
  e.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cached) => {
        const networkFetch = fetch(request).then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        }).catch(() => cached);

        return cached || networkFetch;
      })
    )
  );
});

// Listen for skip-waiting message from app update flow
self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
