/* store.js — where your edits live.
 *
 * Three layers, each doing one job:
 *
 *   localStorage   the working copy. Written on every change, instantly.
 *   Drive          the durable copy in your own hidden app folder. Written a
 *                  couple of seconds after you stop, and again when the tab
 *                  goes away. Survives a wiped browser and a new machine.
 *   baseline       the curated JSON committed to the repo. Only ever read, and
 *                  only when there is nothing saved yet.
 *
 * Everything is keyed by the signed-in Gmail address, so two people sharing a
 * browser never see each other's rows.
 */
(function (root) {
  'use strict';

  var SCHEMA = 3;
  var PREFIX = 'job-pipeline/v3/';
  var SAVE_DELAY = 2000;

  /* Keys written by earlier versions of the tracker on this same origin.
   * Checked once, on first sign-in, so edits made before there were accounts
   * are not stranded. */
  var LEGACY = ['job-pipeline/rb/v1', 'job-pipeline/sb/v1',
                'job-pipeline/blank/v1', 'job-pipeline/edits/v1',
                'design-role-pipeline/edits/v1'];

  function nowISO() { return new Date().toISOString(); }

  function blank(account, baseline) {
    return {
      schema: SCHEMA, version: 0, updatedAt: nowISO(),
      account: account || '', baseline: baseline || '',
      /* the rows themselves, once a baseline has been chosen or a sweep run;
       * null means "nothing chosen yet, fall back to a committed baseline" */
      applications: null,
      /* per-row UI state and hand-edits, keyed by row id */
      rows: {}, deleted: []
    };
  }

  function readLocal(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeLocal(key, doc) {
    try { localStorage.setItem(key, JSON.stringify(doc)); return true; }
    catch (e) { return false; }
  }

  function Store() {
    this.doc = blank();
    this.key = '';
    this.drive = null;            // set by attachDrive()
    this.remoteFileId = null;
    this.timer = null;
    this.saving = false;
    this.dirty = false;
    this.listeners = [];
  }

  /* 'idle' | 'saving' | 'saved' | 'offline' | 'error' — the toast listens. */
  Store.prototype.on = function (fn) { this.listeners.push(fn); };
  Store.prototype.emit = function (state, detail) {
    this.listeners.forEach(function (fn) {
      try { fn(state, detail); } catch (e) {}
    });
  };

  Store.prototype.open = function (account) {
    this.key = PREFIX + String(account || 'local').toLowerCase();
    this.doc = readLocal(this.key) || blank(account, '');
    if (this.doc.schema !== SCHEMA) this.doc = this.upgrade(this.doc, account);
    this.doc.account = account || this.doc.account;
    return this.doc;
  };

  Store.prototype.upgrade = function (old, account) {
    /* Version 1 and 2 stored a bare {id: edits} map with no envelope. */
    var fresh = blank(account, '');
    if (old && !old.schema && typeof old === 'object') fresh.rows = old;
    else if (old && old.rows) { fresh.rows = old.rows; fresh.deleted = old.deleted || []; }
    return fresh;
  };

  /* Per-row edits, the shape app.js already works with. */
  Store.prototype.rows = function () { return this.doc.rows; };

  /* The application list. Null until a baseline is chosen or a sweep lands. */
  Store.prototype.applications = function () { return this.doc.applications; };

  Store.prototype.setApplications = function (list, baselineId) {
    this.doc.applications = list;
    if (baselineId !== undefined) this.doc.baseline = baselineId;
    this.touch();
  };

  /* An empty applications array counts as empty — "Start empty" that found
   * nothing must not lock you out of the chooser next time you sign in. */
  Store.prototype.isEmpty = function () {
    var apps = this.doc.applications;
    return (!apps || !apps.length) && !Object.keys(this.doc.rows || {}).length;
  };

  /* Record that a field was set by hand, so a later sweep treats it as
   * a conflict rather than something it may quietly overwrite. */
  Store.prototype.markManual = function (id, field) {
    var r = this.doc.rows[id] || (this.doc.rows[id] = {});
    (r.manual || (r.manual = {}))[field] = true;
  };

  Store.prototype.markDeleted = function (mergeKey) {
    if (mergeKey && this.doc.deleted.indexOf(mergeKey) < 0) this.doc.deleted.push(mergeKey);
  };

  Store.prototype.undeleted = function (mergeKey) {
    var i = this.doc.deleted.indexOf(mergeKey);
    if (i > -1) this.doc.deleted.splice(i, 1);
  };

  /* Something changed. Write locally now, push to Drive shortly. */
  Store.prototype.touch = function () {
    this.doc.version = (this.doc.version || 0) + 1;
    this.doc.updatedAt = nowISO();
    writeLocal(this.key, this.doc);
    this.dirty = true;
    this.schedule();
  };

  Store.prototype.schedule = function () {
    var self = this;
    if (!this.drive) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(function () { self.flush(); }, SAVE_DELAY);
  };

  Store.prototype.flush = function () {
    var self = this;
    clearTimeout(this.timer);
    if (!this.drive || !this.dirty) return Promise.resolve(false);
    if (this.saving) { this.schedule(); return Promise.resolve(false); }

    this.saving = true;
    this.emit('saving');
    var snapshot = this.doc.version;

    return this.drive.save(this.doc).then(function (res) {
      self.saving = false;
      if (self.doc.version === snapshot) self.dirty = false;
      self.remoteFileId = res && res.id ? res.id : self.remoteFileId;
      self.emit('saved', { at: new Date() });
      if (self.dirty) self.schedule();
      return true;
    }, function (err) {
      self.saving = false;
      self.emit('error', { error: err });
      return false;
    });
  };

  Store.prototype.attachDrive = function (drive) {
    this.drive = drive;
    if (this.dirty) this.schedule();
  };

  /* Pull the Drive copy and decide which side wins. Newer version number wins;
   * a tie goes to whichever was written last. */
  Store.prototype.syncFromDrive = function () {
    var self = this;
    if (!this.drive) return Promise.resolve({ used: 'local', reason: 'no drive' });

    return this.drive.load().then(function (remote) {
      if (!remote) return { used: 'local', reason: 'nothing saved yet' };
      if (remote.account && self.doc.account && remote.account !== self.doc.account) {
        return { used: 'local', reason: 'the saved copy belongs to another account' };
      }

      var localV = self.doc.version || 0, remoteV = remote.version || 0;
      if (remoteV > localV ||
          (remoteV === localV && (remote.updatedAt || '') > (self.doc.updatedAt || ''))) {
        self.doc = remote;
        writeLocal(self.key, self.doc);
        return { used: 'remote', version: remoteV };
      }
      if (localV > remoteV) { self.dirty = true; self.schedule(); }
      return { used: 'local', version: localV };
    });
  };

  /* Old keys on this origin that still hold something. */
  Store.prototype.legacy = function () {
    var found = [];
    LEGACY.forEach(function (k) {
      var d = readLocal(k);
      var n = d ? Object.keys(d.rows || d).length : 0;
      if (n) found.push({ key: k, count: n });
    });
    return found;
  };

  Store.prototype.importLegacy = function (key) {
    var old = readLocal(key);
    if (!old) return 0;
    var src = old.rows || old, n = 0;
    var rows = this.doc.rows;
    Object.keys(src).forEach(function (id) {
      if (!rows[id]) { rows[id] = src[id]; n++; }
    });
    if (n) this.touch();
    return n;
  };

  /* Belt and braces: a file you can keep anywhere. */
  Store.prototype.exportJSON = function () {
    return JSON.stringify(this.doc, null, 2);
  };

  /* Read an export without applying it. The gate uses this to put an import
   * through the same diff as a Gmail sweep, so importing onto a page that
   * already has rows asks rather than overwrites. */
  Store.prototype.readImport = function (text) {
    var incoming = JSON.parse(text);
    if (Array.isArray(incoming)) return { applications: incoming, rows: {}, deleted: [] };
    return {
      applications: Array.isArray(incoming.applications) ? incoming.applications.slice() : [],
      rows: (incoming.rows && typeof incoming.rows === 'object') ? incoming.rows : {},
      deleted: Array.isArray(incoming.deleted) ? incoming.deleted : [],
      baseline: incoming.baseline || 'imported'
    };
  };

  /* The parts of an import that are not applications: hand-edits and the list
   * of things already declined. Both are additive — an import never takes an
   * edit away. */
  Store.prototype.mergeImportMeta = function (parsed) {
    var rows = this.doc.rows, n = 0;
    Object.keys(parsed.rows || {}).forEach(function (id) {
      if (!rows[id]) { rows[id] = parsed.rows[id]; n++; }
    });
    (parsed.deleted || []).forEach(function (k) { this.markDeleted(k); }, this);
    return n;
  };

  Store.prototype.importJSON = function (text) {
    var incoming = JSON.parse(text);

    /* An exported file, or a bare array of applications. */
    if (Array.isArray(incoming)) {
      this.doc.applications = incoming.slice();
      this.doc.baseline = 'imported';
      this.touch();
      return incoming.length;
    }

    var n = 0;
    if (Array.isArray(incoming.applications)) {
      this.doc.applications = incoming.applications.slice();
      this.doc.baseline = incoming.baseline || 'imported';
      n = incoming.applications.length;
    }

    var src = incoming.rows;
    if (src && typeof src === 'object') {
      var rows = this.doc.rows;
      Object.keys(src).forEach(function (id) { rows[id] = src[id]; });
    }
    if (!n && !src) throw new Error('That file has no applications in it.');

    (incoming.deleted || []).forEach(function (k) { this.markDeleted(k); }, this);
    this.touch();
    return n;
  };

  var API = { Store: Store, SCHEMA: SCHEMA, PREFIX: PREFIX, LEGACY: LEGACY, blank: blank };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.TrackerStore = API;
})(typeof window !== 'undefined' ? window : globalThis);
