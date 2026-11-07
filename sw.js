// Offline support. App files: network first (so updates show up), falling back to the saved copy.
// Fonts: saved copy first. ESV passages are not cached here; esv.js keeps a few recent ones itself.

const CACHE = "lectio-v9";
const APP_FILES = [
  "./", "index.html", "styles.css", "app.js", "esv.js", "reader.js", "library.js", "sync.js", "devotionals.json", "manifest.webmanifest",
  "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  if (url.host === "fonts.googleapis.com" || url.host === "fonts.gstatic.com") {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    })));
    return;
  }

  if (url.origin !== location.origin) return;
  // Recordings stream in byte ranges, which iOS needs to handle itself.
  if (url.pathname.includes("/audio/")) return;

  // "no-cache" asks the server whether a file changed, so an update is never half-applied.
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
