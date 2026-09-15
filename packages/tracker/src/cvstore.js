/* cvstore.js — the CV library.
 *
 * Two layers, the same shape as the application store:
 *
 *   IndexedDB   the files themselves, on this machine. A CV is a PDF or a
 *               Word document and can run to megabytes, so localStorage is
 *               not an option — it holds strings, and only a few of them.
 *   Drive       a copy of every file, plus the index, in the same hidden app
 *               folder the applications back up to. This is what makes the
 *               library follow you: sign in on another machine and the list
 *               is there, with each file pulled down the first time you open
 *               it.
 *
 * The index — names, dates, sizes, which contract type each CV is for — is a
 * small JSON document and rides in both places, so the list can be drawn
 * before Drive has answered.
 *
 * Without Google (an offline build opened from the filesystem) everything
 * still works; it just stays on the one machine.
 */
(function (root) {
  'use strict';

  var DB_NAME = 'job-pipeline-cv';
  var SHELF = 'blobs';
  var INDEX_FILE = 'cv-index.json';
  var PREFIX = 'job-pipeline/v3/cv/';
  var MAX_BYTES = 25 * 1024 * 1024;

  /* What a CV is allowed to be. Anything else is almost always a mistake —
   * a screenshot of a CV, or the covering email saved as .eml. */
  var TYPES = {
    '.pdf':  'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc':  'application/msword',
    '.odt':  'application/vnd.oasis.opendocument.text',
    '.rtf':  'application/rtf',
    '.txt':  'text/plain; charset=utf-8',
    '.pages': 'application/x-iwork-pages-sffpages'
  };

  function extOf(filename) {
    var m = String(filename || '').toLowerCase().match(/\.[a-z0-9]+$/);
    return m ? m[0] : '';
  }

  function uuid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return 'cv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function nowISO() { return new Date().toISOString(); }

  /* ------------------------------------------------------------ IndexedDB -- */

  var dbp = null;

  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res) {
      if (!root.indexedDB) return res(null);
      var req;
      try { req = root.indexedDB.open(DB_NAME, 1); } catch (e) { return res(null); }
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(SHELF)) d.createObjectStore(SHELF);
      };
      req.onsuccess = function () { res(req.result); };
      /* A private window, or storage the browser has decided to block. The
       * library then runs off Drive alone, which is slower but not broken. */
      req.onerror = function () { res(null); };
    });
    return dbp;
  }

  function shelf(mode) {
    return db().then(function (d) {
      if (!d) return null;
      try { return d.transaction(SHELF, mode).objectStore(SHELF); }
      catch (e) { return null; }
    });
  }

  function idbPut(id, blob) {
    return shelf('readwrite').then(function (s) {
      if (!s) return false;
      return new Promise(function (res) {
        var r = s.put(blob, id);
        r.onsuccess = function () { res(true); };
        r.onerror = function () { res(false); };
      });
    });
  }

  function idbGet(id) {
    return shelf('readonly').then(function (s) {
      if (!s) return null;
      return new Promise(function (res) {
        var r = s.get(id);
        r.onsuccess = function () { res(r.result || null); };
        r.onerror = function () { res(null); };
      });
    });
  }

  function idbDelete(id) {
    return shelf('readwrite').then(function (s) {
      if (!s) return false;
      return new Promise(function (res) {
        var r = s.delete(id);
        r.onsuccess = function () { res(true); };
        r.onerror = function () { res(false); };
      });
    });
  }

  /* ---------------------------------------------------------------- store -- */

  function Library() {
    this.key = PREFIX + 'local';
    this.index = [];
    this.files = null;        // the Drive side, once attached
    this.listeners = [];
    this.urls = {};           // id -> object URL, revoked when the file changes
    this.syncing = false;
  }

  Library.prototype.on = function (fn) { this.listeners.push(fn); };
  Library.prototype.emit = function () {
    var self = this;
    this.listeners.forEach(function (fn) { try { fn(self.index); } catch (e) {} });
  };

  Library.prototype.open = function (account) {
    this.key = PREFIX + String(account || 'local').toLowerCase();
    try {
      var raw = localStorage.getItem(this.key);
      this.index = raw ? (JSON.parse(raw) || []) : [];
    } catch (e) { this.index = []; }
    if (!Array.isArray(this.index)) this.index = [];
    this.emit();
    return this.index;
  };

  Library.prototype.save = function () {
    try { localStorage.setItem(this.key, JSON.stringify(this.index)); } catch (e) {}
    this.emit();
    if (this.files) {
      var self = this;
      this.files.saveJson(INDEX_FILE, { updatedAt: nowISO(), cvs: this.index })
        .catch(function () { /* the local copy is already written; Drive can wait */ });
    }
  };

  Library.prototype.attachDrive = function (files) { this.files = files; };

  /* Pull the Drive index and fold it together with this machine's. A CV is
   * only ever added, renamed, retyped or soft-deleted, so the newer touchedAt
   * wins per entry and nothing has to be reconciled by hand. */
  Library.prototype.sync = function () {
    var self = this;
    if (!this.files) return Promise.resolve({ used: 'local' });
    this.syncing = true;
    return this.files.loadJson(INDEX_FILE).then(function (remote) {
      self.syncing = false;
      var theirs = (remote && remote.cvs) || [];
      if (!theirs.length && !self.index.length) return { used: 'local', count: 0 };

      var byId = {};
      self.index.forEach(function (c) { byId[c.id] = c; });
      var changed = false;
      theirs.forEach(function (c) {
        var mine = byId[c.id];
        if (!mine) { byId[c.id] = c; self.index.push(c); changed = true; return; }
        if ((c.touchedAt || '') > (mine.touchedAt || '')) {
          Object.keys(c).forEach(function (k) { mine[k] = c[k]; });
          changed = true;
        }
      });
      self.index.sort(function (a, b) {
        return String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || ''));
      });
      if (changed) self.save(); else self.emit();
      return { used: 'remote', count: self.index.length };
    }, function () {
      self.syncing = false;
      return { used: 'local', error: true };
    });
  };

  Library.prototype.all = function () { return this.index.slice(); };
  Library.prototype.live = function () {
    return this.index.filter(function (c) { return !c.deletedAt; });
  };
  Library.prototype.get = function (id) {
    return this.index.filter(function (c) { return c.id === id; })[0] || null;
  };

  /* --------------------------------------------------------------- upload -- */

  Library.prototype.add = function (file, name, kind) {
    var self = this;
    if (!file) return Promise.reject(new Error('Choose a file first.'));

    var ext = extOf(file.name);
    if (!TYPES[ext]) {
      return Promise.reject(new Error(
        'Choose a PDF, Word, Pages, ODT, RTF or TXT file — ' +
        (ext ? ext + ' files' : 'that file') + ' cannot be opened as a CV.'));
    }
    if (!file.size) return Promise.reject(new Error('That file is empty.'));
    if (file.size > MAX_BYTES) {
      return Promise.reject(new Error('CVs must be 25 MB or smaller. That one is ' +
        (file.size / 1024 / 1024).toFixed(1) + ' MB.'));
    }

    var entry = {
      id: uuid(),
      name: String(name || '').trim().slice(0, 160) || file.name.replace(/\.[^.]+$/, ''),
      filename: String(file.name).split(/[\\/]/).pop().slice(0, 200),
      kind: kind || 'General',
      ext: ext,
      size: file.size,
      uploadedAt: nowISO(),
      touchedAt: nowISO(),
      driveId: null
    };

    /* On disk first: an upload that Drive refuses should still leave you with
     * a usable CV on the machine you uploaded it from. */
    return idbPut(entry.id, file).then(function () {
      self.index.unshift(entry);
      self.save();
      if (!self.files) return entry;
      return self.files.upload('cv-' + entry.id + ext, TYPES[ext], file).then(function (driveId) {
        entry.driveId = driveId;
        entry.touchedAt = nowISO();
        self.save();
        return entry;
      }, function () {
        /* Left on this machine only. The next sync tries again. */
        return entry;
      });
    });
  };

  /* Anything uploaded before Drive was reachable, pushed up now. */
  Library.prototype.pushPending = function () {
    var self = this;
    if (!this.files) return Promise.resolve(0);
    var pending = this.index.filter(function (c) { return !c.driveId && !c.deletedAt; });
    if (!pending.length) return Promise.resolve(0);
    return pending.reduce(function (chain, entry) {
      return chain.then(function (n) {
        return idbGet(entry.id).then(function (blob) {
          if (!blob) return n;
          return self.files.upload('cv-' + entry.id + entry.ext, TYPES[entry.ext] || 'application/octet-stream', blob)
            .then(function (driveId) {
              entry.driveId = driveId;
              entry.touchedAt = nowISO();
              return n + 1;
            }, function () { return n; });
        });
      });
    }, Promise.resolve(0)).then(function (n) {
      if (n) self.save();
      return n;
    });
  };

  /* ----------------------------------------------------------------- read -- */

  /* A URL the browser can open. From IndexedDB if this machine has the file,
   * otherwise pulled down from Drive once and kept. */
  Library.prototype.url = function (id) {
    var self = this;
    if (this.urls[id]) return Promise.resolve(this.urls[id]);
    var entry = this.get(id);
    if (!entry) return Promise.reject(new Error('That CV is no longer in your library.'));
    if (entry.deletedAt) {
      return Promise.reject(new Error('That CV was deleted. Restore it in the library to open it.'));
    }

    function hand(blob) {
      var url = URL.createObjectURL(
        blob.type ? blob : new Blob([blob], { type: TYPES[entry.ext] || 'application/octet-stream' }));
      self.urls[id] = url;
      return url;
    }

    return idbGet(id).then(function (blob) {
      if (blob) return hand(blob);
      if (!self.files || !entry.driveId) {
        throw new Error('That CV was uploaded on another machine, and this one is not signed in to fetch it.');
      }
      return self.files.download(entry.driveId).then(function (fetched) {
        idbPut(id, fetched);
        return hand(fetched);
      });
    });
  };

  Library.prototype.forget = function (id) {
    if (this.urls[id]) { try { URL.revokeObjectURL(this.urls[id]); } catch (e) {} }
    delete this.urls[id];
  };

  /* ---------------------------------------------------------------- edits -- */

  Library.prototype.rename = function (id, name) {
    var c = this.get(id);
    if (!c) return false;
    c.name = String(name || '').trim().slice(0, 160) || c.filename.replace(/\.[^.]+$/, '');
    c.touchedAt = nowISO();
    this.save();
    return true;
  };

  Library.prototype.retype = function (id, kind) {
    var c = this.get(id);
    if (!c) return false;
    c.kind = kind || 'General';
    c.touchedAt = nowISO();
    this.save();
    return true;
  };

  /* Soft delete, exactly as the row delete works: the file stays where it is
   * and the entry is marked, so "I deleted the wrong version" is recoverable
   * rather than a story about a CV that no longer exists. */
  Library.prototype.remove = function (id) {
    var c = this.get(id);
    if (!c) return false;
    c.deletedAt = nowISO();
    c.touchedAt = c.deletedAt;
    this.forget(id);
    this.save();
    return true;
  };

  Library.prototype.restore = function (id) {
    var c = this.get(id);
    if (!c) return false;
    delete c.deletedAt;
    c.touchedAt = nowISO();
    this.save();
    return true;
  };

  /* Really gone — the Drive copy and the local blob both. Only reachable from
   * the deleted list, and only on purpose. */
  Library.prototype.purge = function (id) {
    var self = this;
    var c = this.get(id);
    if (!c) return Promise.resolve(false);
    var i = this.index.indexOf(c);
    if (i > -1) this.index.splice(i, 1);
    this.forget(id);
    this.save();
    return idbDelete(id).then(function () {
      if (self.files && c.driveId) return self.files.remove(c.driveId).catch(function () {});
    }).then(function () { return true; });
  };

  var lib = new Library();

  /* Another tab of the same app added or deleted a CV. */
  if (root.addEventListener) {
    root.addEventListener('storage', function (e) {
      if (!e.key || e.key !== lib.key) return;
      try { lib.index = JSON.parse(e.newValue || '[]') || []; } catch (err) { return; }
      lib.emit();
    });
  }

  root.CVStore = lib;
  root.CVStore.TYPES = TYPES;
  root.CVStore.MAX_BYTES = MAX_BYTES;
  root.CVStore.Library = Library;
})(typeof window !== 'undefined' ? window : globalThis);
