/* gate.js — the hosted build: sign in, pick whose rows to draw, refresh them.
 *
 * Only runs when tracker.config.json says mode: "hosted". Offline builds render
 * their baked-in data at load and never load this file's behaviour.
 *
 * The shape of a session:
 *
 *   sign in  →  which mailbox?  →  anything saved in Drive or this browser?
 *                                    yes → draw it
 *                                    no  → pick a starting point, then draw it
 *
 * Refresh re-authorises, sweeps, and shows you what it found before anything
 * lands. Cancel changes nothing.
 */
(function (root) {
  'use strict';

  var cfg = root.TRACKER_CONFIG || {};
  if (cfg.mode !== 'hosted') return;

  var store = new root.TrackerStore.Store();
  root.Tracker = store;

  var BASELINES = root.BASELINES || {};
  var SITE = root.SITE || {};

  var gate = null, statusEl = null;

  /* ------------------------------------------------------------- helpers -- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function say(msg, tone) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className = 'gate-status' + (tone ? ' gate-' + tone : '');
  }

  function toast(o) { return root.Toast ? root.Toast.show(o) : null; }

  /* ---------------------------------------------------------- sign-in UI -- */

  function buildGate() {
    gate = el('div', 'gate');
    gate.id = 'gate';

    var card = el('div', 'gate-card');
    if (root.PageChrome && root.PageChrome.brand) {
      var mark = el('div', 'gate-brand');
      mark.appendChild(root.PageChrome.brand());
      card.appendChild(mark);
    } else {
      card.appendChild(el('div', 'gate-eyebrow', 'Job pipeline'));
    }
    card.appendChild(el('h1', 'gate-title', SITE.title || 'Your applications'));
    card.appendChild(el('p', 'gate-blurb',
      'Sign in with the Google account whose mailbox you want to track. ' +
      'Your rows are stored in your own Google Drive, in a hidden folder only ' +
      'this page can see.'));

    var btn = el('button', 'gate-btn');
    btn.type = 'button';
    btn.id = 'gate-signin';
    btn.innerHTML = cfg.demo
      ? '<span class="gate-btn-label">Sign in (demo)</span>'
      : '<span class="acct-ic">' + GMAIL_MARK + '</span>' +
        '<span class="gate-btn-label">Sign in with Google</span>';
    btn.addEventListener('click', signIn);
    card.appendChild(btn);

    statusEl = el('div', 'gate-status');
    card.appendChild(statusEl);

    var note = el('p', 'gate-note', cfg.demo
      ? 'Demo build. Google is stood in for locally — no real account is ' +
        'touched, no mail is read, and "Drive" is this browser. Every button ' +
        'works; the data is the committed baselines.'
      : 'Read-only access to your mail — this page cannot send, reply, label or ' +
        'delete anything. You are asked to sign in every visit; nothing is kept ' +
        'between sessions except the rows themselves.');
    card.appendChild(note);

    gate.appendChild(card);
    document.body.appendChild(gate);
    document.body.classList.add('gated');
  }

  function closeGate() {
    if (gate) gate.remove();
    document.body.classList.remove('gated');
  }

  /* ------------------------------------------------------- baseline pick -- */

  function chooseBaseline() {
    var card = gate.querySelector('.gate-card');
    card.innerHTML = '';
    card.appendChild(el('div', 'gate-eyebrow', root.Google.account() || ''));
    card.appendChild(el('h1', 'gate-title', 'Nothing saved yet'));
    card.appendChild(el('p', 'gate-blurb',
      'Start from a set of rows that has already been checked over, or sweep ' +
      'your mailbox from scratch. You can change your mind later — this only ' +
      'decides where you begin.'));

    var list = el('div', 'gate-choices');
    Object.keys(BASELINES).forEach(function (id) {
      var b = BASELINES[id];
      var choice = el('button', 'gate-choice');
      choice.type = 'button';
      choice.appendChild(el('span', 'gc-name', b.label || id));
      choice.appendChild(el('span', 'gc-meta',
        (b.rows || []).length + ' applications' + (b.note ? ' · ' + b.note : '')));
      choice.addEventListener('click', function () {
        store.setApplications((b.rows || []).slice(), id);
        offerLegacy();
        start();
      });
      list.appendChild(choice);
    });

    var imp = el('button', 'gate-choice');
    imp.type = 'button';
    imp.appendChild(el('span', 'gc-name', 'Import a file'));
    imp.appendChild(el('span', 'gc-meta',
      'a JSON export from another machine, or from an offline build'));
    imp.addEventListener('click', function () { pickFile(true); });
    list.appendChild(imp);

    var scratch = el('button', 'gate-choice');
    scratch.type = 'button';
    scratch.appendChild(el('span', 'gc-name', 'Start empty'));
    scratch.appendChild(el('span', 'gc-meta', 'sweep the mailbox and build from nothing'));
    scratch.addEventListener('click', function () {
      store.setApplications([], 'empty');
      start();
      refresh();
    });
    list.appendChild(scratch);

    card.appendChild(list);
    statusEl = el('div', 'gate-status');
    card.appendChild(statusEl);
  }

  /* Edits made before this build existed, sitting under an older key on this
   * same origin. Offer them rather than stranding them. */
  function offerLegacy() {
    var old = store.legacy();
    if (!old.length) return;
    var total = old.reduce(function (n, o) { return n + o.count; }, 0);
    toast({
      text: total + ' edits found from an earlier version of the tracker',
      tone: 'info', timeout: 0,
      action: { label: 'Bring them in', onClick: function () {
        var n = 0;
        old.forEach(function (o) { n += store.importLegacy(o.key); });
        toast({ text: n + ' edits restored', tone: 'good' });
        if (root.TrackerApp && root.TrackerApp.reload) root.TrackerApp.reload(store.applications());
      }}
    });
  }

  /* ------------------------------------------------------------- importing -- */

  /* The hosted build ships no real data, so this is how an existing set of rows
   * gets in: a file exported from an offline build or another machine. Offered
   * on the start screen, and from the toolbar afterwards — which is also how
   * you get out of a "Start empty" that found nothing. */
  var picker = null;
  function pickFile(fromGate) {
    if (!picker) {
      picker = document.createElement('input');
      picker.type = 'file';
      picker.accept = 'application/json,.json';
      picker.style.display = 'none';
      document.body.appendChild(picker);
    }
    picker.onchange = function () {
      var file = picker.files && picker.files[0];
      picker.value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var parsed;
        try { parsed = store.readImport(String(reader.result)); }
        catch (e) {
          if (fromGate) say('That file could not be read: ' + e.message, 'bad');
          else toast({ text: 'That file could not be read: ' + e.message, tone: 'bad', timeout: 7000 });
          return;
        }
        if (!parsed.applications.length && !Object.keys(parsed.rows).length) {
          var msg = 'That file has no applications in it.';
          if (fromGate) say(msg, 'bad'); else toast({ text: msg, tone: 'bad', timeout: 7000 });
          return;
        }

        store.mergeImportMeta(parsed);

        /* Nothing on the page yet — the import is the starting point, and
         * there is nothing to ask about. */
        if (store.isEmpty() || !(store.applications() || []).length) {
          store.setApplications(parsed.applications, parsed.baseline);
          if (fromGate) start();
          else root.TrackerApp.reload(store.applications());
          toast({ text: 'Imported ' + parsed.applications.length + ' applications', tone: 'good' });
          return;
        }

        /* There are rows here already. An import used to replace them outright,
         * which quietly threw away everything a Gmail refresh had found. It
         * goes through the same diff as a sweep instead, so it adds rather than
         * overwrites and every new row is yours to tick or refuse. */
        if (fromGate) start();
        var report = root.Merge.diff(currentRows(), parsed.applications, store.doc.deleted);
        showDiff(report, parsed.applications, 'Import');
      };
      reader.readAsText(file);
    };
    picker.click();
  }

  var GMAIL_MARK =
    '<img src="data:image/png;base64,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" alt="" width="48" height="36">';

  /* --------------------------------------------------------------- sign in -- */

  function signIn() {
    var btn = document.getElementById('gate-signin');
    if (btn) btn.disabled = true;
    say('Waiting for Google…');

    root.Google.signIn().then(afterSignIn).catch(function (err) {
      if (btn) btn.disabled = false;
      say(err.message, 'bad');
    });
  }

  /* Everything that happens once an address is known, whether the person just
   * clicked sign in or the tab still held a token from before the refresh. */
  function afterSignIn(account) {
    var btn = document.getElementById('gate-signin');
    return Promise.resolve(account).then(function (account) {
      say('Signed in as ' + account);
      store.open(account);
      store.attachDrive(root.Google.drive);
      store.on(saveStatus);

      /* The CV library is keyed by the same address and backed up to the same
       * hidden Drive folder, so signing in on a second machine finds the CVs
       * already listed — each file pulled down the first time it is opened. */
      if (root.CVStore) {
        root.CVStore.open(account);
        root.CVStore.attachDrive(root.Google.files);
        root.CVStore.sync()
          .then(function () { return root.CVStore.pushPending(); })
          .catch(function () { /* the local copy still works */ });
      }
      return store.syncFromDrive().catch(function (e) {
        toast({ text: 'Could not reach Drive — working from this browser only. ' +
                      e.message, tone: 'warn', timeout: 7000 });
      });
    }).then(function () {
      if (store.isEmpty()) chooseBaseline();
      else start();
    }).catch(function (err) {
      if (btn) btn.disabled = false;
      say(err.message, 'bad');
    });
  }

  /* ---------------------------------------------------------- Drive toasts -- */

  var saveToast = null;
  function saveStatus(state) {
    if (state === 'saving') {
      saveToast = toast({ id: 'drive', text: 'Saving to Google Drive…', tone: 'busy', timeout: 0 });
    } else if (state === 'saved') {
      saveToast = toast({ id: 'drive', text: 'Saved to Google Drive', tone: 'good', timeout: 2200 });
    } else if (state === 'error') {
      saveToast = toast({ id: 'drive', text: 'Could not save to Drive — your edits are still ' +
                          'in this browser', tone: 'bad', timeout: 6000 });
    }
  }

  /* --------------------------------------------------------------- toolbar -- */

  /* R for richardbirley@gmail.com, SB for stuart.birley@… — whatever the
   * address gives up, rather than guessing at a surname that is not there. */
  function initialsFor(address) {
    var local = String(address || '').split('@')[0];
    var parts = local.split(/[._\-+]+/).filter(Boolean);
    if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (local[0] || '?').toUpperCase();
  }



  function buildToolbar() {
    var bar = document.getElementById('acctbar');
    if (!bar) return;
    bar.hidden = false;
    bar.innerHTML = '';

    var address = root.Google.account() || '';

    /* Account, and the three things you do to the whole dataset, behind one
     * control. Refresh stays outside it because it is the thing you actually
     * came to press; Import, Export and Sign out are occasional. */
    var who = el('span', 'acct-who');

    var trigger = el('button', 'acct-trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.title = 'Signed in as ' + address;
    trigger.setAttribute('aria-label', 'Signed in as ' + address + '. Account menu.');
    var av = el('span', 'acct-av', initialsFor(address));
    av.setAttribute('aria-hidden', 'true');
    trigger.appendChild(av);
    trigger.appendChild(el('span', 'acct-mail', address));
    var caret = document.createElement('span');
    caret.className = 'acct-caret';
    caret.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="m6 9 6 6 6-6"/></svg>';
    trigger.appendChild(caret);
    who.appendChild(trigger);

    var menu = el('div', 'acct-menu');
    menu.hidden = true;
    menu.appendChild(el('div', 'am-head', address));

    function item(label, title, onClick) {
      var b = el('button', 'am-item', label);
      b.type = 'button';
      if (title) b.title = title;
      b.addEventListener('click', function () { closeMenu(); onClick(); });
      menu.appendChild(b);
      return b;
    }

    function closeMenu() {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      trigger.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !who.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu();
    });

    item('Import', 'Merge a JSON export into these rows \u2014 you see the diff first',
      function () { pickFile(false); });

    item('Export', 'Download a copy of your rows', function () {
      var blob = new Blob([store.exportJSON()], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'job-pipeline-' + (root.Google.account() || 'export').split('@')[0] + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      toast({ text: 'Exported', tone: 'good' });
    });

    item('Sign out', '', function () {
      store.flush().then(function () { root.Google.signOut(); location.reload(); });
    });

    who.appendChild(menu);

    var chrome = document.querySelector('#pagechrome .chrome-actions');
    if (chrome) chrome.appendChild(who);
    else bar.appendChild(who);

    var actions = el('span', 'acct-actions');
    bar.appendChild(actions);

    var refreshBtn = el('button', 'acct-btn acct-primary');
    refreshBtn.type = 'button';
    refreshBtn.id = 'refreshbtn';
    refreshBtn.innerHTML =
      '<span class="acct-ic">' + GMAIL_MARK + '</span>' +
      '<span class="rb-label">Refresh<span class="rb-long"> from Gmail</span></span>';
    refreshBtn.title = 'Read your mailbox for anything new';
    refreshBtn.addEventListener('click', refresh);
    actions.appendChild(refreshBtn);



  }

  /* ----------------------------------------------------------------- draw -- */

  function start() {
    closeGate();
    var rows = adopt((store.applications() || []).slice(), store.rows());
    /* Two timestamps, two meanings: the masthead says when your rows last
     * changed, the build line at the bottom says when this page was deployed.
     * They were both showing the build time, which made the top one a lie. */
    if (store.doc && store.doc.updatedAt) SITE.updated = store.doc.updatedAt;
    root.Render.all(rows, SITE);
    root.TrackerApp();
    buildToolbar();

    /* A last write before the tab goes, so a closed laptop does not lose the
     * couple of seconds since the last save. */
    window.addEventListener('pagehide', function () { store.flush(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') store.flush();
    });
  }

  /* -------------------------------------------------------------- refresh -- */

  /* A row added with the Add button is written into the edits as
   * new-<timestamp> and never into the application list — and the render, and
   * the merge behind it, only ever walked the application list. So a row you
   * typed in was there until you reloaded, and then it was gone, leaving an
   * orphaned edit nobody could see. Adopt those orphans: they come back, and
   * everything already lost comes back with them.
   *
   * Both the first draw and the refresh go through here. Only one of them did
   * at first, which is a good way to ship half a fix. */
  function adopt(list, edits) {
    var known = {};
    list.forEach(function (a) { known[root.Render.idOf(a)] = true; });
    Object.keys(edits || {}).forEach(function (id) {
      if (known[id]) return;
      var e = edits[id];
      if (!e || (!e.co && !e.role)) return;
      list.push({
        id: id,
        status: e.s || 'wait',
        chip: e.label || 'Awaiting',
        type: e.type || 'Full-Time',
        company: e.co || '',
        role: e.role || '',
        applied: e.date || '\u2014',
        appliedSort: Number(e.applied) || 0,
        updated: e.updShown || '\u2014',
        updatedSort: Number(e.updated) || 0,
        source: e.via || 'Direct',
        sourceLabel: e.viaLabel || e.via || 'Direct',
        note: e.note || '',
        cv: e.cv || '', cl: e.cl || '', jd: e.jd || '',
        star: e.star ? '1' : '',
        manual: e.manual || {}
      });
    });
    list.sort(function (a, b) {
      return (Number(b.appliedSort) || 0) - (Number(a.appliedSort) || 0);
    });
    return list;
  }

  function currentRows() {
    /* The rows as they stand, with each row's hand-edits folded in, so the
     * merge knows what is already decided. */
    var edits = store.rows();
    var out = (store.applications() || []).map(function (a) {
      var id = root.Render.idOf(a);
      var e = edits[id];
      if (!e) return a;
      var out = {};
      Object.keys(a).forEach(function (k) { out[k] = a[k]; });
      if (e.s) out.status = e.s;
      if (e.label) out.chip = e.label;
      if (e.date) out.applied = e.date;
      if (e.applied) out.appliedSort = Number(e.applied);
      if (e.updShown) out.updated = e.updShown;
      if (e.updated) out.updatedSort = Number(e.updated);
      if (e.co) out.company = e.co;
      if (e.role) out.role = e.role;
      if (e.note !== undefined) out.note = e.note;
      if (e.cv) out.cv = e.cv;
      if (e.cl) out.cl = e.cl;
      if (e.jd) out.jd = e.jd;
      if (e.star) out.star = '1';
      out.manual = e.manual || {};
      return out;
    });

    return adopt(out, edits);
  }

  function refresh() {
    var btn = document.getElementById('refreshbtn');
    var label = btn && btn.querySelector('.rb-label');
    function say2(t){ if (label) label.textContent = t; else if (btn) btn.textContent = t; }
    if (btn) { btn.disabled = true; say2('Signing in…'); }

    var progress = toast({ id: 'sweep', text: 'Asking Google for permission…',
                           tone: 'busy', timeout: 0 });

    /* A fresh token every time — the account chooser reappears, so this is
     * also how you refresh a different mailbox. */
    root.Google.signIn().then(function (account) {
      if (account !== store.doc.account) {
        throw new Error('That is ' + account + ', but this page is showing ' +
                        store.doc.account + '. Sign out first to switch accounts.');
      }
      say2('Reading mail…');
      toast({ id: 'sweep', text: 'Reading your mail…', tone: 'busy', timeout: 0 });
      return root.Google.sweep({
        rules: root.RULES,
        months: cfg.sweepMonths || 6,
        /* The rows already on the page, so the second pass knows which
         * employers are still worth chasing for a reply. */
        known: currentRows(),
        onProgress: function (done, total, stage) {
          toast({ id: 'sweep', text: (stage || 'Reading your mail') + '… ' + done +
                                     ' of ' + total + ' threads',
                  tone: 'busy', timeout: 0 });
        }
      });
    }).then(function (incoming) {
      if (progress) progress.dismiss();
      var report = root.Merge.diff(currentRows(), incoming, store.doc.deleted);
      showDiff(report, incoming, 'Refresh from Gmail');
    }).catch(function (err) {
      if (progress) progress.dismiss();
      toast({ text: err.message, tone: 'bad', timeout: 8000 });
    }).then(function () {
      if (btn) {
        btn.disabled = false;
        if (label) label.innerHTML = 'Refresh<span class="rb-long"> from Gmail</span>';
        else btn.textContent = 'Refresh from Gmail';
      }
    });
  }

  /* --------------------------------------------------------- the diff view -- */

  function fieldLine(f) {
    var from = (f.from === '' || f.from == null) ? '—' : f.from;
    return f.field + ': ' + from + ' → ' + f.to;
  }

  function showDiff(report, incoming, from) {
    var dlg = document.getElementById('diffdlg');
    var body = document.getElementById('diff-body');
    var head = document.getElementById('diff-title');
    var picks = {};
    var skipAdded = {};
    var split = root.Merge.partitionAdded(report);

    /* Rows the sweep could not name start excluded. Indeed's confirmations
     * genuinely do not carry the employer, so these are always guesses. */
    split.unnamed.forEach(function (r) { skipAdded[root.Merge.keyOf(r)] = true; });

    head.textContent = (from || 'Refresh') + ' — ' + root.Merge.summarise(report);
    body.innerHTML = '';

    if (!report.added.length && !report.changed.length && !report.conflicts.length) {
      body.appendChild(el('p', 'diff-empty',
        'Nothing new in ' + incoming.length + ' applications found. ' +
        'Everything on the page is up to date.'));
    }

    function section(title, note) {
      var s = el('div', 'diff-sec');
      s.appendChild(el('h4', null, title));
      if (note) s.appendChild(el('p', 'diff-note', note));
      body.appendChild(s);
      return s;
    }

    /* Keys that were put in front of the person with a tick box. Only these
     * can be recorded as declined — a row that was never shown was never
     * refused, and turning it into a permanent no would be a decision the
     * person did not make. */
    var offered = {};
    var boxes = [];

    if (split.named.length) {
      var addSec = section(split.named.length + ' new ' +
        (split.named.length === 1 ? 'application' : 'applications'),
        'All ticked. Untick anything that is not really an application — ' +
        'those are remembered, so a later refresh will not offer them again.');

      var all = el('label', 'diff-all');
      var allBox = document.createElement('input');
      allBox.type = 'checkbox';
      allBox.checked = true;
      all.appendChild(allBox);
      all.appendChild(el('span', 'dc-text', 'Tick all'));
      addSec.appendChild(all);

      split.named.forEach(function (r) {
        var key = root.Merge.keyOf(r);
        offered[key] = true;
        var lab = el('label', 'diff-conflict diff-add');
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = true;
        box.addEventListener('change', function () {
          skipAdded[key] = !box.checked;
          allBox.checked = boxes.every(function (b) { return b.checked; });
        });
        boxes.push(box);
        lab.appendChild(box);
        var txt = el('span', 'dc-text');
        txt.appendChild(el('span', 'di-co', r.company));
        txt.appendChild(el('span', 'di-role', r.role));
        txt.appendChild(el('span', 'di-meta', r.applied + ' · ' + r.chip + ' · via ' + r.source));
        lab.appendChild(txt);
        addSec.appendChild(lab);
      });

      allBox.addEventListener('change', function () {
        boxes.forEach(function (b) {
          b.checked = allBox.checked;
          b.dispatchEvent(new Event('change'));
        });
        allBox.checked = boxes.every(function (x) { return x.checked; });
      });
    }

    /* dropUnnamed (the default) keeps rows the sweep could not name out of the
     * diff altogether — they are still counted, so it is never silent. Set it
     * false in tracker.config.json to be offered them one by one instead. */
    if (split.unnamed.length && cfg.dropUnnamed !== false) {
      section(split.unnamed.length + ' ignored',
        'The sweep found these but could not work out the employer — Indeed ' +
        'never names it. Skipped. Turn off dropUnnamed in tracker.config.json ' +
        'to be offered them individually.');
    }

    if (split.unnamed.length && cfg.dropUnnamed === false) {
      var unSec = section(split.unnamed.length + " the sweep couldn't name",
        'Real applications, but the confirmation never says who from — Indeed ' +
        'is the usual culprit. Left out unless you tick one. You can always ' +
        'add it by hand and name it yourself.');
      split.unnamed.forEach(function (r) {
        var key = root.Merge.keyOf(r);
        offered[key] = true;
        var lab = el('label', 'diff-conflict');
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.addEventListener('change', function () { skipAdded[key] = !box.checked; });
        lab.appendChild(box);
        var txt = el('span', 'dc-text');
        txt.appendChild(el('span', 'di-role', r.role));
        txt.appendChild(el('span', 'di-meta', r.applied + ' · ' + r.chip + ' · via ' + r.source));
        lab.appendChild(txt);
        unSec.appendChild(lab);
      });
    }

    if (report.changed.length) {
      var chSec = section(report.changed.length + ' updated');
      report.changed.forEach(function (c) {
        var item = el('div', 'diff-item');
        item.appendChild(el('span', 'di-co', c.row.company));
        item.appendChild(el('span', 'di-role', c.row.role));
        item.appendChild(el('span', 'di-meta', c.fields.filter(function (f) {
          return f.field !== 'appliedSort' && f.field !== 'updatedSort';
        }).map(fieldLine).join(' · ')));
        chSec.appendChild(item);
      });
    }

    if (report.conflicts.length) {
      var cfSec = section(report.conflicts.length + ' needing a decision',
        'You set these by hand. Tick one to let the mailbox overwrite it; leave ' +
        'it alone and yours stands.');
      report.conflicts.forEach(function (c) {
        c.fields.forEach(function (f) {
          var id = c.key + '::' + f.field;
          var lab = el('label', 'diff-conflict');
          var box = document.createElement('input');
          box.type = 'checkbox';
          box.addEventListener('change', function () { picks[id] = box.checked; });
          lab.appendChild(box);
          var txt = el('span', 'dc-text');
          txt.appendChild(el('span', 'di-co', c.row.company));
          txt.appendChild(el('span', 'di-meta', fieldLine(f)));
          lab.appendChild(txt);
          cfSec.appendChild(lab);
        });
      });
    }

    /* Previously declined, and the only place they can be undone. Without this
     * an accidental untick is permanent and silent — the row would never be
     * offered again on any machine, with no screen that admits it exists. */
    var restore = {};
    if (report.skipped.length) {
      var skSec = section(report.skipped.length + ' left out',
        'You deleted or declined these before, so the sweep keeps finding them ' +
        'and keeps leaving them out. Tick one to take it back.');
      report.skipped.forEach(function (sk) {
        var lab = el('label', 'diff-conflict');
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.addEventListener('change', function () { restore[sk.key] = box.checked; });
        lab.appendChild(box);
        var txt = el('span', 'dc-text');
        txt.appendChild(el('span', 'di-co', sk.row.company));
        txt.appendChild(el('span', 'di-role', sk.row.role));
        txt.appendChild(el('span', 'di-meta', sk.row.applied + ' · ' + sk.row.chip));
        lab.appendChild(txt);
        skSec.appendChild(lab);
      });
    }

    var applyBtn = document.getElementById('diff-apply');
    applyBtn.disabled = !report.added.length && !report.changed.length &&
                        !report.conflicts.length && !report.skipped.length;
    applyBtn.onclick = function () {
      /* An untick is a decision, so it is kept: recorded by merge key, written
       * to Drive with everything else, and honoured by the next sweep on any
       * machine. Only rows that carried a tick box can be refused this way. */
      var refused = 0;
      Object.keys(skipAdded).forEach(function (k) {
        if (skipAdded[k] && offered[k]) { store.markDeleted(k); refused++; }
      });
      var back = 0;
      Object.keys(restore).forEach(function (k) {
        if (restore[k]) { store.undeleted(k); back++; }
      });

      var merged = root.Merge.apply(currentRows(), report,
        { conflicts: picks, skipAdded: skipAdded });

      /* Anything taken back has to be put in by hand, since the diff had set it
       * aside before the person changed their mind. */
      if (back) {
        report.skipped.forEach(function (sk) {
          if (!restore[sk.key]) return;
          merged.rows.push(sk.row);
          merged.applied.added++;
        });
      }
      store.setApplications(merged.rows.map(function (r) {
        var copy = {};
        Object.keys(r).forEach(function (k) { if (k !== 'manual') copy[k] = r[k]; });
        return copy;
      }));
      dlg.close();
      var said = ['Added ' + merged.applied.added,
                  'updated ' + (merged.applied.changed + merged.applied.conflicts)];
      if (refused) said.push(refused + ' will not be offered again');
      if (back) said.push(back + ' taken back');
      toast({ text: said.join(', '), tone: 'good' });
      root.TrackerApp.reload(store.applications());
      /* The masthead's timestamp is about the rows, so applying a refresh has
       * to move it — reload() only redraws the table. */
      if (store.doc && store.doc.updatedAt) {
        SITE.updated = store.doc.updatedAt;
        root.Render.mast(store.applications() || [], SITE);
      }
      store.flush();
    };
    document.getElementById('diff-cancel').onclick = function () { dlg.close(); };

    dlg.showModal();
  }

  /* ----------------------------------------------------------------- boot -- */

  root.Google.configure(cfg.googleClientId || '');
  buildGate();

  /* A refresh should not cost a sign-in. The token lives in sessionStorage for
   * the life of the tab, so if it is still good, go straight in — and if it is
   * not, the gate is already drawn and waiting. */
  if (root.Google.resume) {
    root.Google.resume().then(function (account) {
      if (account) afterSignIn(account);
    }).catch(function () { /* fall through to the gate */ });
  }

  if (!root.Google.configured()) {
    var b = document.getElementById('gate-signin');
    if (b) b.disabled = true;
    say('This build has no Google client ID yet. Add one to ' +
        'apps/web/tracker.config.json — SETUP.md walks through it.', 'bad');
  }

  root.TrackerGate = { store: store, refresh: refresh, start: start, signIn: signIn };
})(window);
