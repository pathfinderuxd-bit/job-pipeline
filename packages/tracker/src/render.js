/* render.js — turns plain JSON into the markup app.js expects.
 *
 * Load order matters: config.js, data, then this file, then app.js. app.js
 * reads the rows out of the DOM on start-up, so every row must exist before it
 * runs.
 *
 * In an offline build this renders immediately from the baked-in data. In a
 * hosted build it waits: gate.js decides whose rows to draw once someone has
 * signed in, then calls Render.all() and boots the app.
 */
(function (root) {
  'use strict';

  /* Sort order down the table. A lead is not a conversation and not a rejection
 * — it is something worth applying to that has not been applied to yet, so it
 * sits below the live ones and above what is already closed out. */
var RANK = { live: 0, wait: 1, lead: 2, shut: 3 };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function slug() {
    var t = Array.prototype.slice.call(arguments).join('-').toLowerCase();
    return t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  /* First letter of the employer, for the row avatar. Skips a leading article
   * so "The Guardian" reads G, and falls back to a dash when there is no name
   * yet — an empty square looks broken, an obvious placeholder does not. */
  function initial(company) {
    var name = String(company || '').replace(/^(the|a|an)\s+/i, '').trim();
    var ch = name.charAt(0);
    return /[a-z0-9]/i.test(ch) ? ch.toUpperCase() : '\u2014';
  }

  function idOf(a) {
    return a.id || slug(a.company || '', a.role || '', a.applied || '');
  }

  /* ---------------------------------------------------------------- rows -- */

  /* cvui.js owns what goes in here — the library, grouped by what each CV is
   * for, plus the open / upload / manage actions. Without it (a build that
   * predates the library) fall back to the plain list of labels. */
  function cvSelect(current) {
    var opts = root.cvOptionsHtml
      ? root.cvOptionsHtml(current)
      : (root.CV_OPTIONS || []).map(function (o) {
          return '<option' + (o === current ? ' selected' : '') + '>' + esc(o) + '</option>';
        }).join('');
    return '<select class="cvsel" aria-label="CV used">' + opts + '</select>';
  }

  var STAR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<path d="m12 3.7 2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.7l-5.1 2.7.97-5.68L3.75 9.7l5.7-.83z"/></svg>';

  var TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/>' +
    '<path d="M6.5 7 7.5 19a2 2 0 0 0 2 1.9h5a2 2 0 0 0 2-1.9L17.5 7"/>' +
    '<path d="M9.5 7V5.2a1.2 1.2 0 0 1 1.2-1.2h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/></svg>';

  function rowHtml(a) {
    var status = a.status || 'wait';
    var type = a.type || 'Full-Time';
    var cv = a.cv || (root.CV_SEED || {})[type] || '—';
    var badge = (root.SRC_BADGE || {})[a.source] || ['?', ''];
    var icon = (root.TYPE_ICONS || {})[type] || '';
    var note = a.note ? '<span class="note">' + esc(a.note) + '</span>' : '';

    return '<tr data-id="' + esc(idOf(a)) + '" data-s="' + esc(status) +
      '" data-applied="' + (a.appliedSort || 0) +
      '" data-updated="' + (a.updatedSort || 0) +
      '" data-via="' + esc(a.source || 'Unknown') +
      '" data-type="' + esc(type) +
      '" data-date="' + esc(a.applied || '—') +
      '" data-co="' + esc(String(a.company || '').toLowerCase()) +
      '" data-role="' + esc(String(a.role || '').toLowerCase()) +
      '" data-rank="' + (RANK[status] == null ? 1 : RANK[status]) +
      '" data-cv="' + esc(cv) + '" data-cl="" data-jd="" data-star="0">' +
      '<td class="c-star"><button type="button" class="starbtn" aria-pressed="false" ' +
        'aria-label="Star this application">' + STAR_SVG + '</button></td>' +
      '<td class="c-status"><button type="button" class="pill">' +
        '<span class="dot dot-' + esc(status) + '"></span>' + esc(a.chip || '') + '</button></td>' +
      '<td class="c-date">' + esc(a.applied || '—') + '</td>' +
      '<td class="c-co"><span class="cellf">' +
        '<span class="coav" aria-hidden="true">' + esc(initial(a.company)) + '</span>' +
        '<button type="button" class="copill">' + esc(a.company || '') + '</button>' +
        '</span></td>' +
      '<td class="c-role">' + esc(a.role || '') + note + '</td>' +
      '<td class="c-type"><span class="cellf"><span class="tyi">' + icon +
        '</span><span>' + esc(type) + '</span></span></td>' +
      '<td class="c-src"><span class="cellf"><span class="vlogo ' + badge[1] + '">' + badge[0] +
        '</span><span>' + esc(a.sourceLabel || a.source || '') + '</span></span></td>' +
      '<td class="c-upd">' + esc(a.updated || '—') + '</td>' +
      '<td class="c-cl"><button type="button" class="clbtn">Add</button></td>' +
      '<td class="c-cv">' + cvSelect(cv) + '</td>' +
      '<td class="c-act">' +
        '<button type="button" class="delbtn" aria-label="Delete this row">' + TRASH_SVG + '</button>' +
        '<button type="button" class="rowbtn" aria-label="Edit this row">&#8943;</button>' +
        '</td></tr>';
  }

  function renderRows(list) {
    var tb = document.getElementById('tb');
    if (tb) tb.innerHTML = (list || []).map(rowHtml).join('\n');
  }

  /* ------------------------------------------------------ masthead + cards -- */

  function counts(list) {
    var c = { live: 0, wait: 0, lead: 0, shut: 0 };
    (list || []).forEach(function (a) { if (c[a.status] != null) c[a.status]++; });
    return c;
  }

  function filler(list, site) {
    var c = counts(list);
    return function (text) {
      return String(text || '')
        .replace(/\{\{N\}\}/g, (list || []).length)
        .replace(/\{\{LIVE\}\}/g, c.live)
        .replace(/\{\{WAIT\}\}/g, c.wait)
        .replace(/\{\{LEAD\}\}/g, c.lead)
        .replace(/\{\{SHUT\}\}/g, c.shut)
        .replace(/\{\{UPDATED\}\}/g, niceWhen(site && site.updated));
    };
  }

  function renderMast(list, site) {
    var fill = filler(list, site);
    function setText(id, value) {
      var el = document.getElementById(id);
      if (el) el.textContent = fill(value);
    }
    setText('mast-eyebrow', site.eyebrow);
    setText('mast-title', site.title || 'Job Pipeline');
    setText('mast-standfirst', site.standfirst);
    if (site.title) document.title = fill(site.title);
  }

  /* Which build is on screen. Written the way a date is written here — 14 Sept
   * 2026, 15:25 — rather than the browser's default, which turns into American
   * order and a 12-hour clock on a machine set to en-US. */
  /* One date format for the whole page: 15 Sept 2026, 12:50. The browser's
   * default turns into month-first and a 12-hour clock on a machine set to
   * en-US, so the same build would read differently to each of us. */
  function whenText(d) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
           ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  /* The masthead's timestamp arrives either as an ISO string (the store knows
   * when it last changed) or as the DD/MM/YY:HH:MM stamp the build writes. */
  function niceWhen(value) {
    var v = String(value || '');
    if (!v) return '';
    var m = v.match(/^(\d{2})\/(\d{2})\/(\d{2}):(\d{2}):(\d{2})$/);
    if (m) return whenText(new Date(Date.UTC(2000 + +m[3], +m[2] - 1, +m[1], +m[4], +m[5])));
    var d = new Date(v);
    return isNaN(d.getTime()) ? v : whenText(d);
  }

  function builtWhen(iso) {
    try {
      return whenText(new Date(iso));
    } catch (e) { return ''; }
  }

  function renderBuild() {
    var el = document.getElementById('buildline');
    var b = root.BUILD;
    if (!el || !b) return;
    var when = builtWhen(b.builtAt);
    el.innerHTML =
      '<span class="vtag">v' + esc(b.version) + (b.lineage ? ' ' + esc(b.lineage) : '') + '</span>' +
      '<span>' + esc(b.app) + ' \u00b7 theme ' + esc(b.theme) + '</span>' +
      (when ? '<span class="vsep">\u00b7</span><span>built ' + esc(when) + '</span>' : '');
    el.hidden = false;
  }

  function renderInsights(list, site) {
    var track = document.getElementById('ins-track');
    if (!track) return;
    var fill = filler(list, site);
    var insights = site.insights || [];
    var section = track.closest ? track.closest('.insights') : null;
    if (!insights.length) { if (section) section.hidden = true; return; }
    if (section) section.hidden = false;
    track.innerHTML = insights.map(function (c, i) {
      return '<article>' +
        '<div class="ins-kicker">Insight ' + (i + 1) +
          (c.kicker ? ' &middot; ' + esc(c.kicker) : '') + '</div>' +
        '<h3>' + esc(fill(c.title)) + '</h3>' +
        '<p>' + esc(fill(c.body)) + '</p>' +
        '</article>';
    }).join('\n');
  }

  function all(list, site) {
    renderRows(list);
    renderMast(list, site || {});
    renderBuild();
    renderInsights(list, site || {});
  }

  root.Render = { all: all, rows: renderRows, rowHtml: rowHtml, idOf: idOf,
                  initial: initial, build: renderBuild, when: niceWhen,
                  mast: renderMast, insights: renderInsights, counts: counts };

  /* An offline build has its data already and boots straight away. A hosted
   * build waits for gate.js. */
  var cfg = root.TRACKER_CONFIG || {};
  if (cfg.mode !== 'hosted') {
    all(root.APPLICATIONS || [], root.SITE || {});
    root.__BOOT_NOW = true;
  }
})(typeof window !== 'undefined' ? window : globalThis);
