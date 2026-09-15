// Service worker KomikuNesia
// - App shell (HTML/CSS/JS/ikon): cache-first, update di background
// - API: network-first dengan fallback cache (data basi lebih baik daripada error)

const VERSION = "v6";
const SHELL_CACHE = `shell-${VERSION}`;
const API_CACHE = `api-${VERSION}`;
const IMG_CACHE = `img-${VERSION}`;
const API_MAX = 50;
const IMG_MAX = 120;

const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/browse.html",
  "/search.html",
  "/detail.html",
  "/favorites.html",
  "/read.html",
  "/gate.html",
  "/css/style.css",
  "/css/reader.css",
  "/js/core.js",
  "/js/reader.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => ![SHELL_CACHE, API_CACHE, IMG_CACHE].includes(k))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return; // gambar komiku (komiku.to) & non-GET: biarkan langsung jaringan
  }

  if (url.pathname.startsWith("/api/")) {
    // Thumb kecil (&w=400): cache-first 120 entri. Halaman reader full (&w=800+ / tanpa w): jaringan saja.
    if (url.pathname.startsWith("/api/img")) {
      const w = parseInt(url.searchParams.get("w") || "0", 10);
      if (w > 0 && w <= 400) {
        event.respondWith(
          caches.match(event.request).then((hit) => {
            const fetchAndPut = fetch(event.request).then((res) => {
              if (res.ok) {
                const copy = res.clone();
                caches.open(IMG_CACHE).then(async (c) => {
                  await c.put(event.request, copy);
                  const keys = await c.keys();
                  if (keys.length > IMG_MAX) {
                    await Promise.all(keys.slice(0, keys.length - IMG_MAX).map((k) => c.delete(k)));
                  }
                });
              }
              return res;
            }).catch(() => hit);
            return hit || fetchAndPut;
          })
        );
      }
      return;
    }
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok && res.status !== 401) {
            const copy = res.clone();
            caches.open(API_CACHE).then(async (c) => {
              await c.put(event.request, copy);
              const keys = await c.keys();
              if (keys.length > API_MAX) {
                await Promise.all(keys.slice(0, keys.length - API_MAX).map((k) => c.delete(k)));
              }
            });
          }
          return res;
        })
        .catch(() =>
          caches.match(event.request).then(
            (hit) =>
              hit ||
              new Response(
                JSON.stringify({ status: false, message: "Offline" }),
                { status: 503, headers: { "Content-Type": "application/json" } }
              )
          )
        )
    );
    return;
  }

  // app shell & navigasi: cache-first, revalidate di background
  event.respondWith(
    caches.match(event.request, { ignoreSearch: url.pathname === "/" }).then((hit) => {
      const fetchAndUpdate = fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || fetchAndUpdate;
    })
  );
});
