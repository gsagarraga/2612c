/* 2612/c - service worker de la app de campo: la deja funcionar sin conexion */
importScripts('sync-core.js');

var CACHE = '2612c-encuestas-v1';
var SHELL = ['./app.html', './sync-core.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function esArchivoDeLaApp(url) {
  return /\/(app\.html|sync-core\.js|manifest\.webmanifest|icon-192\.png|icon-512\.png)$/.test(url.pathname);
}
function esFuente(url) {
  return /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.host);
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var mismoOrigen = url.origin === self.location.origin;
  if (!(mismoOrigen && esArchivoDeLaApp(url)) && !esFuente(url)) return;

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      var red = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          var copia = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copia); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || red;
    })
  );
});

/* Android/Chrome: si la app esta cerrada, el sistema despierta esto cuando vuelve la conexion */
self.addEventListener('sync', function (e) {
  if (e.tag === 'sync-respuestas') {
    e.waitUntil(S2612.getCfg().then(function (cfg) { return cfg ? S2612.pushPending(cfg) : null; }));
  }
});
