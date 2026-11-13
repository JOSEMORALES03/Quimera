const CACHE_NAME = "quimera-shell-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./supabase-config.js",
  "./manifest.webmanifest",
  "./quimera-icon-192.png",
  "./quimera-icon-512.png",
  "./order-notification.mp3",
  "./terminos-y-condiciones-quimera.pdf"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith("quimera-shell-") && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  if (request.method !== "GET" || requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request).then(async response => {
        if (response.ok) {
          try {
            await caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
          } catch (error) {
            console.error("No se pudo actualizar la caché de Quimera.", error);
          }
        }
        return response;
      }).catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const appPage = await caches.match("./index.html");
          if (appPage) return appPage;
        }
        return Response.error();
      })
  );
});
