/* letters.js — cover letters from one template.
 *
 * A template is plain text with {{company}}, {{role}} and (optionally) {{why}}
 * where the names go. "New letter" asks for the two names, fills them in and
 * hands back the text to copy. Templates belong to the signed-in account and
 * travel in its Drive data and its export file — they are never in the repo,
 * because a letter carries a name and a phone number.
 *
 * fill() is pure so the tests can run it without a page. The rest is the view.
 */
(function (root) {
  'use strict';

  var TOKEN = /\{\{\s*(company|role|why)\s*\}\}/gi;
  var GONE = '\u0000';

  /* "Senior Product Designer — London, hybrid" is a role plus where it is.
   * A letter wants only the first half. */
  function roleName(role) {
    return String(role == null ? '' : role).split(/\s+[—–-]\s+/)[0].trim();
  }

  /* An empty {{why}} takes its whole line (and one blank line after it) with
   * it, so a template that gives it a paragraph of its own does not leave a
   * hole. An empty company or role stays as the token, so it cannot be missed. */
  function fill(text, vars) {
    var v = vars || {};
    var out = String(text == null ? '' : text).replace(TOKEN, function (m, k) {
      var val = String(v[k.toLowerCase()] || '').trim();
      if (val) return val;
      return k.toLowerCase() === 'why' ? GONE : m;
    });
    if (out.indexOf(GONE) === -1) return out;
    var lines = out.split('\n'), keep = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].replace(/\s+/g, '') === GONE) {
        if (lines[i + 1] !== undefined && lines[i + 1].trim() === '') i++;
        continue;
      }
      keep.push(lines[i].split(GONE).join(''));
    }
    return keep.join('\n');
  }

  /* Which names are still unfilled in a finished letter. */
  function unfilled(text) {
    var found = {}, m, re = /\{\{\s*(company|role)\s*\}\}/gi;
    while ((m = re.exec(String(text || '')))) found[m[1].toLowerCase()] = true;
    return Object.keys(found);
  }

  var API = { fill: fill, unfilled: unfilled, roleName: roleName };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Letters = API;
  if (typeof document === 'undefined' || typeof module !== 'undefined') return;

  /* ------------------------------------------------------------------ view -- */

  var DEFAULT_TEXT =
    'Dear Hiring Team at {{company}},\n\n' +
    'I am writing to apply for the {{role}} position at {{company}}.\n\n' +
    '{{why}}\n\n' +
    'Write your own paragraphs here, then press New letter any time you need one.\n\n' +
    'Regards,\n\n';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function store() { return root.Tracker || null; }
  function toast(text, tone) { if (root.Toast) root.Toast.show({ text: text, tone: tone || 'good' }); }
  function newId() { return 't' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }

  function data() {
    var s = store();
    if (!s || !s.doc) return null;
    var d = s.doc;
    if (!d.letters || !Array.isArray(d.letters.templates)) d.letters = { templates: [], active: '', last: {} };
    return d.letters;
  }
  function save() { var s = store(); if (s && s.touch) s.touch(); }

  function ensure() {
    var L = data();
    if (!L) return null;
    if (!L.templates.length) {
      L.templates.push({ id: newId(), name: 'My cover letter', text: DEFAULT_TEXT });
      L.active = L.templates[0].id;
      save();
    }
    return L;
  }
  function current() {
    var L = ensure();
    if (!L) return null;
    for (var i = 0; i < L.templates.length; i++) if (L.templates[i].id === L.active) return L.templates[i];
    L.active = L.templates[0].id;
    return L.templates[0];
  }

  function copy(text, done) {
    var tmp = $('lt-out');
    function fallback() { tmp.select(); try { document.execCommand('copy'); } catch (e) {} done(); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  /* --- the prompt: company, role, optional hook --- */
  var ltDlg, askDone = null;

  function applicationsList() {
    var s = store(), list = (s && s.applications && s.applications()) || [];
    var order = { live: 0, lead: 1, wait: 2, idea: 3, shut: 4 };
    return list.slice().sort(function (a, b) { return (order[a.status] || 0) - (order[b.status] || 0); });
  }

  function ask(opts) {
    var o = opts || {}, L = ensure();
    if (!L || !ltDlg) return;
    var last = L.last || {};
    $('ltd-company').value = o.company != null ? o.company : (last.company || '');
    $('ltd-role').value = o.role != null ? roleName(o.role) : (last.role || '');
    $('ltd-why').value = o.why || '';
    var apps = applicationsList();
    $('ltd-from').innerHTML = '<option value="">Pick one of your applications…</option>' +
      apps.map(function (a, i) {
        return '<option value="' + i + '">' + esc(a.company) + ' — ' + esc(roleName(a.role)) + '</option>';
      }).join('');
    $('ltd-from').onchange = function () {
      var a = apps[Number(this.value)];
      if (!a) return;
      $('ltd-company').value = a.company;
      $('ltd-role').value = roleName(a.role);
    };
    $('ltd-tpl').innerHTML = L.templates.map(function (t) {
      return '<option value="' + esc(t.id) + '"' + (t.id === L.active ? ' selected' : '') + '>' + esc(t.name) + '</option>';
    }).join('');
    askDone = o.done || null;
    ltDlg.showModal();
    ($('ltd-company').value ? $('ltd-role') : $('ltd-company')).focus();
  }

  function generate(ev) {
    ev.preventDefault();
    var L = ensure();
    var vars = { company: $('ltd-company').value.trim(), role: $('ltd-role').value.trim(), why: $('ltd-why').value.trim() };
    if (!vars.company || !vars.role) return;
    var tid = $('ltd-tpl').value;
    if (tid) L.active = tid;
    L.last = { company: vars.company, role: vars.role };
    save();
    var text = fill(current().text, vars);
    ltDlg.close();
    if (askDone) askDone(text, vars);
  }

  /* --- the page --- */
  var cur = { company: '', role: '' };
  var prompted = false, delArmed = false;

  function drawPick() {
    var L = ensure(), c = current();
    $('lt-pick').innerHTML = L.templates.map(function (t) {
      return '<option value="' + esc(t.id) + '"' + (t.id === c.id ? ' selected' : '') + '>' + esc(t.name) + '</option>';
    }).join('');
    $('lt-tname').value = c.name;
    $('lt-ttext').value = c.text;
  }

  function showLetter(text, vars) {
    cur = { company: vars.company, role: vars.role };
    $('lt-out').value = text;
    $('lt-meta').textContent = vars.company + ' · ' + vars.role;
    $('lt-result').hidden = false;
    $('lt-empty').hidden = true;
    var missing = unfilled(text);
    $('lt-hint').textContent = missing.length
      ? 'This template has {{' + missing[0] + '}} in a place the prompt does not reach — edit the template.'
      : 'Edit it here if you like, then copy.';
  }

  function showView(on) {
    var sec = $('letters'), btn = $('lettersbtn');
    if (!sec) return;
    if (on) { ensure(); drawPick(); }
    sec.hidden = !on;
    Array.prototype.forEach.call(sec.parentNode.children, function (el) {
      if (el === sec || el.tagName === 'HEADER' || el.tagName === 'DIALOG') return;
      if (on) {
        if (el.dataset.ltWas === undefined) el.dataset.ltWas = el.hidden ? '1' : '0';
        el.hidden = true;
      } else if (el.dataset.ltWas !== undefined) {
        el.hidden = el.dataset.ltWas === '1';
        delete el.dataset.ltWas;
      }
    });
    document.body.classList.toggle('lt-on', !!on);
    if (btn) btn.setAttribute('aria-pressed', String(!!on));
    window.scrollTo(0, 0);
    if (on && !prompted && !$('lt-out').value) { prompted = true; ask({ done: showLetter }); }
  }

  function wire() {
    ltDlg = $('ltdlg');
    var btn = $('lettersbtn');
    if (!btn || !ltDlg) return;
    /* The offline build has no account to keep templates in. */
    if (!root.Google) { btn.hidden = true; return; }

    btn.addEventListener('click', function () { showView(true); });
    $('lt-back').addEventListener('click', function () { showView(false); });
    $('ltd-form').addEventListener('submit', generate);
    $('ltd-cancel').addEventListener('click', function () { ltDlg.close(); });
    $('lt-new').addEventListener('click', function () { ask({ done: showLetter }); });
    $('lt-more').addEventListener('click', function () { ask({ company: cur.company, role: cur.role, done: showLetter }); });

    $('lt-copy').addEventListener('click', function () {
      copy($('lt-out').value, function () { $('lt-hint').textContent = 'Copied to clipboard'; toast('Cover letter copied'); });
    });
    $('lt-savejob').addEventListener('click', function () {
      var ok = root.TrackerApp && root.TrackerApp.setLetter &&
               root.TrackerApp.setLetter(cur.company, cur.role, $('lt-out').value);
      if (ok) toast('Saved to the cover letter on ' + ok);
      else toast('No application for ' + cur.company + ' yet — add the row first, then save.', 'warn');
    });

    $('lt-edit').addEventListener('click', function () {
      var box = $('lt-tpl'), open = box.hidden;
      box.hidden = !open;
      $('lt-edit').setAttribute('aria-expanded', String(open));
      if (open) { drawPick(); $('lt-ttext').focus(); }
    });
    $('lt-pick').addEventListener('change', function () {
      var L = ensure(); L.active = this.value; save(); drawPick();
    });
    $('lt-tname').addEventListener('input', function () {
      current().name = this.value; save();
      var opt = $('lt-pick').selectedOptions[0]; if (opt) opt.textContent = this.value;
    });
    $('lt-ttext').addEventListener('input', function () { current().text = this.value; save(); });
    $('lt-add').addEventListener('click', function () {
      var L = ensure(), t = { id: newId(), name: 'New template', text: DEFAULT_TEXT };
      L.templates.push(t); L.active = t.id; save(); drawPick();
      $('lt-tpl').hidden = false; $('lt-tname').select();
    });
    $('lt-del').addEventListener('click', function () {
      var L = ensure(), b = this;
      if (L.templates.length < 2) { toast('Keep at least one template.', 'warn'); return; }
      if (!delArmed) {
        delArmed = true; b.textContent = 'Really delete?';
        setTimeout(function () { delArmed = false; b.textContent = 'Delete template'; }, 3500);
        return;
      }
      delArmed = false; b.textContent = 'Delete template';
      L.templates = L.templates.filter(function (t) { return t.id !== L.active; });
      L.active = L.templates[0].id; save(); drawPick();
    });
  }

  root.Letters.ask = ask;
  root.Letters.show = showView;
  wire();
})(typeof window !== 'undefined' ? window : globalThis);
