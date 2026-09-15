/* cvui.js — the CV column dropdown, and the library behind it.
 *
 * The dropdown does three jobs from one control: it says which CV went with
 * an application, it opens that CV, and it is the way into the library. The
 * three actions sit in their own group at the bottom, so they never read as
 * another CV to choose.
 *
 * The library itself is a view rather than a separate page. It is routed at
 * #cv-library — the back button works, the URL can be bookmarked, "Manage CV
 * library" opens it — but it stays inside the one document, which matters:
 * the Google token lives in memory and is never written down, so a second
 * page would mean signing in twice to upload one file.
 */
(function (root) {
  'use strict';

  var NONE = '—';
  var UPLOAD = '__cv_upload__';
  var OPEN = '__cv_open__';
  var MANAGE = '__cv_library__';
  var ROUTE = '#cv-library';

  /* A CV is written for a kind of work, not for one application, which is why
   * the dropdown groups by this and the library asks for it on upload. */
  var KINDS = ['General', 'Full-Time', 'Part-Time', 'Contract',
               'Temporary', 'Freelance', 'Fractional'];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function lib() { return root.CVStore; }

  function cvOf(value) {
    if (!lib() || String(value).indexOf('cv:') !== 0) return null;
    return lib().get(String(value).slice(3));
  }

  /* --------------------------------------------------------------- labels -- */

  function displayName(value) {
    if (!value || value === NONE) return 'Select CV…';
    var cv = cvOf(value);
    /* A CV that has been deleted stays readable on the row that used it —
     * which CV went out is a fact about an application that already happened,
     * and losing it would be worse than a slightly longer label. */
    if (cv) {
      return cv.name + ' · ' + cv.ext.slice(1).toUpperCase() +
             (cv.deletedAt ? ' (deleted)' : '');
    }
    /* A row can outlive the file it points at, and a row imported from an
     * older dataset carries a plain label rather than a file at all. Say
     * which, rather than showing a dead id. */
    if (String(value).indexOf('cv:') === 0) return 'Deleted or unavailable CV';
    return value + ' — no file';
  }

  function optionsHtml(current, includeActions) {
    var cur = current || NONE;
    var seen = {};
    var html = '<option value="' + esc(NONE) + '"' + (cur === NONE ? ' selected' : '') + '>' +
               esc(displayName(NONE)) + '</option>';

    var cvs = lib() ? lib().live() : [];
    KINDS.forEach(function (kind) {
      var group = cvs.filter(function (c) { return (c.kind || 'General') === kind; });
      if (!group.length) return;
      html += '<optgroup label="' + esc(kind) + '">';
      group.forEach(function (c) {
        var v = 'cv:' + c.id;
        seen[v] = true;
        html += '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' +
                esc(displayName(v)) + '</option>';
      });
      html += '</optgroup>';
    });

    /* Whatever this row is already set to stays selectable, even if it is a
     * deleted file or a label from before the library existed — silently
     * dropping it would look like the app had forgotten. */
    if (cur !== NONE && !seen[cur]) {
      html += '<optgroup label="On this row">' +
              '<option value="' + esc(cur) + '" selected>' + esc(displayName(cur)) + '</option>' +
              '</optgroup>';
    }

    if (includeActions !== false) {
      html += '<optgroup label="CV actions">';
      if (seen[cur]) html += '<option value="' + OPEN + '">Open this CV ↗</option>';
      html += '<option value="' + UPLOAD + '">Upload a CV…</option>' +
              '<option value="' + MANAGE + '">Manage CV library…</option>' +
              '</optgroup>';
    }
    return html;
  }

  /* Redraw every dropdown on the page, each keeping its own row's value. */
  function refreshSelects() {
    Array.prototype.forEach.call(document.querySelectorAll('.cvsel'), function (sel) {
      var tr = sel.closest('tr');
      sel.innerHTML = optionsHtml(tr ? tr.getAttribute('data-cv') : NONE);
    });
    var ed = document.getElementById('ed-cv');
    if (ed) {
      var keep = ed.value;
      ed.innerHTML = optionsHtml(keep, false);
      ed.value = keep;
    }
  }

  /* ------------------------------------------------------------ open a CV -- */

  function openCv(value, say) {
    var cv = cvOf(value);
    if (!cv) { say('There is no file on this row to open.', true); return; }
    say('Opening ' + cv.name + '…');
    /* Opened at click time so the browser counts it as a user action; if the
     * file has to come down from Drive first, the tab is already there. */
    var tab = window.open('', '_blank');
    lib().url(cv.id).then(function (url) {
      if (tab) { tab.location = url; say(''); }
      else {
        var a = document.createElement('a');
        a.href = url; a.download = cv.filename;
        document.body.appendChild(a); a.click(); a.remove();
        say('');
      }
    }, function (err) {
      if (tab) tab.close();
      say(err.message, true);
    });
  }

  /* ------------------------------------------------------------- library -- */

  var dlg, body, statusEl, fileInput, nameInput, kindInput;

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  /* The same date format as the rest of the page. toLocaleString(undefined)
   * gives month-first and a 12-hour clock on a machine set to en-US, which
   * would make one library read two ways. */
  function fmtDate(iso) {
    if (root.Render && root.Render.when) return root.Render.when(iso);
    try {
      return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    } catch (e) { return iso || ''; }
  }

  function say(text, bad) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.classList.toggle('bad', !!bad);
  }

  function kindOptions(current) {
    return KINDS.map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === current ? ' selected' : '') + '>' +
             esc(k) + '</option>';
    }).join('');
  }

  function drawList() {
    if (!body) return;
    var cvs = lib().live();
    var gone = lib().all().filter(function (c) { return c.deletedAt; });

    var rows = cvs.map(function (c) {
      var used = usageOf(c.id);
      return '<div class="cvl-row" data-cv="' + esc(c.id) + '">' +
        '<span class="cvl-c cvl-file"><span class="cvl-kind">' + esc(c.ext.slice(1).toUpperCase()) + '</span>' +
          '<span class="cvl-names"><strong>' + esc(c.name) + '</strong>' +
          '<span class="cvl-sub">' + esc(c.filename) +
          (c.driveId ? '' : ' \u00b7 this machine only') + '</span></span></span>' +
        '<span class="cvl-c" data-l="Used for"><select class="cvl-type" aria-label="What this CV is used for">' +
          kindOptions(c.kind || 'General') + '</select></span>' +
        '<span class="cvl-c cvl-when" data-l="Uploaded">' + esc(fmtDate(c.uploadedAt)) + '</span>' +
        '<span class="cvl-c cvl-size" data-l="Size">' + esc(fmtSize(c.size || 0)) + '</span>' +
        '<span class="cvl-c cvl-used" data-l="On">' + (used ? used + ' application' + (used === 1 ? '' : 's') : '\u2014') + '</span>' +
        '<span class="cvl-c cvl-act">' +
          '<button type="button" class="btn-ghost cvl-open">Open</button>' +
          '<button type="button" class="btn-ghost cvl-del">Delete</button></span>' +
        '</div>';
    }).join('');

    body.querySelector('#cvl-rows').innerHTML = rows;
    body.querySelector('#cvl-empty').hidden = !!cvs.length;
    body.querySelector('#cvl-list').classList.toggle('is-empty', !cvs.length);
    body.querySelector('#cvl-count').textContent =
      cvs.length + ' ' + (cvs.length === 1 ? 'version' : 'versions');

    var del = body.querySelector('#cvl-deleted');
    del.hidden = !gone.length;
    body.querySelector('#cvl-deleted-count').textContent = 'Deleted CVs (' + gone.length + ')';
    body.querySelector('#cvl-deleted-list').innerHTML = gone.map(function (c) {
      return '<li data-cv="' + esc(c.id) + '"><span>' + esc(c.name) + ' · ' +
        esc(c.ext.slice(1).toUpperCase()) + '</span>' +
        '<span class="cvl-act"><button type="button" class="btn-ghost cvl-restore">Restore</button>' +
        '<button type="button" class="btn-ghost cvl-purge">Delete for good</button></span></li>';
    }).join('');
  }

  /* How many applications point at this CV — the thing you actually want to
   * know before deleting one. */
  function usageOf(id) {
    var n = 0;
    Array.prototype.forEach.call(document.querySelectorAll('#tb tr'), function (tr) {
      if (tr.getAttribute('data-cv') === 'cv:' + id) n++;
    });
    return n;
  }

  function build() {
    if (dlg) return;
    dlg = document.getElementById('cvldlg');
    if (!dlg) return;
    body = dlg;
    statusEl = dlg.querySelector('#cvl-status');
    fileInput = dlg.querySelector('#cvl-file');
    nameInput = dlg.querySelector('#cvl-name');
    kindInput = dlg.querySelector('#cvl-kindsel');
    kindInput.innerHTML = kindOptions('General');

    dlg.querySelector('#cvl-close').addEventListener('click', function () { close(); });
    dlg.addEventListener('close', function () {
      if (location.hash === ROUTE) history.replaceState(null, '', location.pathname + location.search);
    });

    dlg.querySelector('#cvl-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var file = fileInput.files[0];
      var btn = dlg.querySelector('#cvl-submit');
      btn.disabled = true;
      say('Uploading…');
      lib().add(file, nameInput.value, kindInput.value).then(function (entry) {
        btn.disabled = false;
        e.target.reset();
        kindInput.innerHTML = kindOptions('General');
        say(entry.driveId
          ? 'Uploaded ' + entry.name + '. It is in the CV dropdown, and backed up to your Drive.'
          : 'Uploaded ' + entry.name + '. It is on this machine; sign in to back it up to Drive.');
      }, function (err) {
        btn.disabled = false;
        say(err.message, true);
      });
    });

    /* One delegated listener: the list is redrawn whenever anything changes,
     * so per-button handlers would not survive. */
    dlg.addEventListener('click', function (e) {
      var row = e.target.closest('[data-cv]');
      if (!row) return;
      var id = row.getAttribute('data-cv');
      if (e.target.closest('.cvl-open')) { openCv('cv:' + id, say); return; }
      if (e.target.closest('.cvl-del')) {
        var used = usageOf(id);
        lib().remove(id);
        /* Open the deleted list rather than just mentioning it — the undo has
         * to be in front of you at the moment you might want it. */
        var det = dlg.querySelector('#cvl-deleted');
        if (det) det.open = true;
        say(used
          ? 'Deleted. ' + used + ' application' + (used === 1 ? ' still points' : 's still point') +
            ' at it \u2014 you can restore it below.'
          : 'Deleted \u2014 you can restore it below.');
        return;
      }
      if (e.target.closest('.cvl-restore')) { lib().restore(id); say('Restored.'); return; }
      if (e.target.closest('.cvl-purge')) {
        lib().purge(id).then(function () { say('Deleted for good.'); });
      }
    });

    dlg.addEventListener('change', function (e) {
      var sel = e.target.closest('.cvl-type');
      if (!sel) return;
      var row = sel.closest('[data-cv]');
      lib().retype(row.getAttribute('data-cv'), sel.value);
      say('Moved to ' + sel.value + '.');
    });
  }

  function open(focus) {
    build();
    if (!dlg) return;
    drawList();
    if (location.hash !== ROUTE) history.pushState(null, '', ROUTE);
    if (!dlg.open) dlg.showModal();
    say('');
    if (focus === 'upload' && nameInput) nameInput.focus();
    if (lib().files) lib().sync().then(function () { lib().pushPending(); });
  }

  function close() {
    if (location.hash === ROUTE) history.replaceState(null, '', location.pathname + location.search);
    if (dlg && dlg.open) dlg.close();
  }

  /* ----------------------------------------------------------------- wire -- */

  function start() {
    if (!lib()) return;
    /* A build with no sign-in has one library, on this machine. A hosted build
     * has already opened the signed-in person's, so leave that alone. */
    if (!root.Google) lib().open('local');
    lib().on(function () { refreshSelects(); if (dlg && dlg.open) drawList(); });
    refreshSelects();
    if (location.hash === ROUTE) open();
    window.addEventListener('hashchange', function () {
      if (location.hash === ROUTE) open(); else close();
    });
  }

  root.CVUI = {
    KINDS: KINDS, NONE: NONE,
    UPLOAD: UPLOAD, OPEN: OPEN, MANAGE: MANAGE,
    displayName: displayName, optionsHtml: optionsHtml,
    refreshSelects: refreshSelects, openCv: openCv,
    open: open, close: close, start: start,
    isAction: function (v) { return v === UPLOAD || v === OPEN || v === MANAGE; }
  };

  /* app.js calls these by the names Stu's build used. */
  root.cvDisplayName = displayName;
  root.cvOptionsHtml = optionsHtml;
})(typeof window !== 'undefined' ? window : globalThis);
