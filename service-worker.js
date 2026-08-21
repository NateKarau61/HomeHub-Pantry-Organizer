// Minimal offline support: caches the app's own files so the site still opens (and shows
// whatever was last loaded) without a signal. Anything from another origin — Firebase,
// the barcode lookup API, the html5-qrcode CDN script — always goes straight to the network,
// since that data needs to be live, not cached.
const CACHE_NAME = "pantry-organizer-v6";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./firebase-config.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./favicon-32.png",
  "./favicon-16.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(() => { /* ok if a file is missing/renamed — the rest still gets cached individually where possible */ })
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // let cross-origin requests go straight to network

  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
