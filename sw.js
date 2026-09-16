/* Record QC service worker — network-first so updates always reach the
 * device, with a cache fallback for offline use. Asset URLs are versioned
 * (?v=N) so a new build can never be masked by a stale cache. */
var CACHE = "recordqc-v34";
var ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=34",
  "./app.js?v=34",
  "./manifest.json",
  "./icons/icon-192.png?v=34",
  "./icons/icon-512.png?v=34",
  "./icons/icon-maskable-512.png?v=34"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Network-first. For page navigations, bypass the HTTP cache entirely so the
// newest index.html (and therefore the newest ?v= assets) always loads online.
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  var isNav = req.mode === "navigate";
  var fetchOpts = isNav ? { cache: "no-store" } : undefined;

  e.respondWith(
    fetch(req, fetchOpts).then(function (resp) {
      var copy = resp.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return resp;
    }).catch(function () {
      return caches.match(req).then(function (cached) {
        return cached || caches.match("./index.html");
      });
    })
  );
});
