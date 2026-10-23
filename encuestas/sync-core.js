/* 2612/c - motor de almacenamiento y sincronizacion (compartido por la app y el service worker) */
(function (root) {
  var DB_NAME = '2612c-encuestas';
  var DB_VER = 1;

  function openDB() {
    return new Promise(function (resolve, reject) {
      var r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains('forms')) db.createObjectStore('forms', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('responses')) db.createObjectStore('responses', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  function withStore(store, mode, op) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var s = t.objectStore(store);
        var req = op(s);
        t.oncomplete = function () { db.close(); resolve(req ? req.result : undefined); };
        t.onerror = t.onabort = function () { db.close(); reject(t.error); };
      });
    });
  }

  function get(store, key) { return withStore(store, 'readonly', function (s) { return s.get(key); }); }
  function getAll(store) { return withStore(store, 'readonly', function (s) { return s.getAll(); }); }
  function put(store, val) { return withStore(store, 'readwrite', function (s) { return s.put(val); }); }
  function del(store, key) { return withStore(store, 'readwrite', function (s) { return s.delete(key); }); }
  function putMany(store, arr) {
    return withStore(store, 'readwrite', function (s) {
      var last;
      arr.forEach(function (v) { last = s.put(v); });
      return last;
    });
  }
  function clear(store) { return withStore(store, 'readwrite', function (s) { return s.clear(); }); }

  function getMeta(key) { return get('meta', key).then(function (r) { return r ? r.value : null; }); }
  function setMeta(key, value) { return put('meta', { key: key, value: value }); }
  function getCfg() { return getMeta('cfg'); }
  function setCfg(cfg) { return setMeta('cfg', cfg); }

  function fetchTimeout(url, opts, ms) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms || 20000);
    opts = opts || {};
    opts.signal = ctrl.signal;
    return fetch(url, opts).finally(function () { clearTimeout(timer); });
  }

  function parseJson(res) {
    return res.text().then(function (t) {
      try { return JSON.parse(t); }
      catch (e) { throw new Error('Respuesta inesperada del servidor. Revisá la URL de conexión.'); }
    });
  }

  /** Descarga los formularios publicados y reemplaza la copia local. */
  function pullForms(cfg) {
    var sep = cfg.url.indexOf('?') >= 0 ? '&' : '?';
    var url = cfg.url + sep + 'action=forms&token=' + encodeURIComponent(cfg.token);
    return fetchTimeout(url, { method: 'GET', redirect: 'follow' }, 15000)
      .then(parseJson)
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || 'No se pudieron descargar los formularios.');
        return clear('forms').then(function () {
          return data.forms.length ? putMany('forms', data.forms) : null;
        }).then(function () { return data.forms; });
      });
  }

  function listResponses() { return getAll('responses'); }
  function pendingList() {
    return getAll('responses').then(function (all) {
      return all.filter(function (r) { return r.status === 'pending'; })
        .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    });
  }
  function pendingCount() { return pendingList().then(function (l) { return l.length; }); }

  /** Envia las respuestas pendientes en lotes. El servidor ignora ids repetidos. */
  function pushPending(cfg) {
    return pendingList().then(function (pending) {
      var sent = 0;
      var chain = Promise.resolve();
      for (var i = 0; i < pending.length; i += 5) {
        (function (chunk) {
          chain = chain.then(function () {
            var body = JSON.stringify({ action: 'responses', token: cfg.token, items: chunk });
            return fetchTimeout(cfg.url, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: body,
              redirect: 'follow'
            }, 30000).then(parseJson).then(function (data) {
              if (!data.ok) throw new Error(data.error || 'El servidor rechazo el envio.');
              var ok = {};
              (data.saved || []).forEach(function (id) { ok[id] = true; });
              var done = chunk.filter(function (r) { return ok[r.id]; }).map(function (r) {
                r.status = 'sent';
                r.sentAt = Date.now();
                return r;
              });
              sent += done.length;
              return done.length ? putMany('responses', done) : null;
            });
          });
        })(pending.slice(i, i + 5));
      }
      return chain.then(function () { return sent; });
    });
  }

  /** Borra del dispositivo las respuestas ya enviadas hace mas de 30 dias. */
  function purgeOld() {
    return getAll('responses').then(function (all) {
      var limit = Date.now() - 30 * 24 * 3600 * 1000;
      return Promise.all(all.filter(function (r) {
        return r.status === 'sent' && r.sentAt && r.sentAt < limit;
      }).map(function (r) { return del('responses', r.id); }));
    });
  }

  root.S2612 = {
    get: get, getAll: getAll, put: put, del: del, putMany: putMany, clear: clear,
    getMeta: getMeta, setMeta: setMeta, getCfg: getCfg, setCfg: setCfg,
    pullForms: pullForms, pushPending: pushPending, pendingList: pendingList,
    pendingCount: pendingCount, listResponses: listResponses, purgeOld: purgeOld
  };
})(typeof self !== 'undefined' ? self : this);
