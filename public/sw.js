/*
  Forge service worker — installability only, NO app-code caching.

  The app needs the network for Supabase/OpenRouter anyway, so caching HTML/JS
  bought us nothing and actively caused stale code to be served after deploys.
  This worker keeps the PWA installable (it has a fetch handler) but proxies
  every request straight to the network, and clears any caches a previous
  version created.
*/
const VERSION = "forge-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // Network-only. Never serve cached app code — always the latest deploy.
  event.respondWith(fetch(event.request));
});
