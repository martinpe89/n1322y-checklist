/* N1322Y — service worker: app shell disponible sin señal (cabina) */
const V = "n1322y-v2";
const SHELL = ["/", "/sync.js", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;               // mutaciones: siempre red (la cola offline las maneja)
  if (url.pathname.startsWith("/api/")) return;          // API: siempre red

  // CDN del OCR (tesseract + traineddata): cache-first para que funcione sin señal
  if (url.origin !== location.origin) {
    if (/cdnjs\.cloudflare\.com|jsdelivr\.net|projectnaptha\.com/.test(url.host)) {
      e.respondWith(
        caches.open(V + "-ocr").then((c) =>
          c.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }))
        )
      );
    }
    return;
  }

  // Shell propio: red primero (para recibir actualizaciones), caché si no hay señal
  e.respondWith(
    fetch(e.request)
      .then((r) => { const cp = r.clone(); caches.open(V).then((c) => c.put(e.request, cp)); return r; })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("/")))
  );
});
