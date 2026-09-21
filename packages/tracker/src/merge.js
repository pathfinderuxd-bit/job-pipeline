/* merge.js — fold a fresh Gmail sweep into the rows you already have.
 *
 * The rule that matters: a field you changed by hand is yours. The sweep may
 * propose a change to it, but it never applies one silently. Everything the
 * sweep cannot know about — stars, cover letters, job descriptions, which CV
 * you sent — it does not touch at all.
 *
 * Pure functions, no DOM, no storage. Runs in the browser and under node, so
 * the tests can exercise it directly.
 */
(function (root) {
  'use strict';

  /* Fields the sweep is allowed to have an opinion about. Anything not listed
   * here belongs to the person and is never proposed, never overwritten. */
  var SWEEP_FIELDS = ['status', 'chip', 'updated', 'updatedSort', 'note',
                      'sourceLabel', 'applied', 'appliedSort'];

  /* Fields that are the person's alone, whatever arrives. */
  var MINE_ONLY = ['star', 'cl', 'jd', 'cv'];

  /* Sort keys travel with the date they sort. Proposing one without the other
   * would report a change nobody can see, and editing the visible date by hand
   * claims its sort key too. */
  var PAIRED = { updatedSort: 'updated', appliedSort: 'applied' };

  function slug(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  /* Identity is company + role, not date — an employer re-acknowledging an
   * application weeks later must land on the row that already exists. The role
   * loses any trailing location or salary clause first, because boards word
   * those inconsistently between the confirmation and the rejection. */
  function roleStem(role) {
    return slug(String(role || '').split(/\s+[—–-]\s+/)[0]);
  }

  function keyOf(row) {
    return slug(row.company) + '::' + roleStem(row.role);
  }

  /* How recent a row is, whatever it carries. A row with no `updated` date is
   * not old — it is undated, and treating 0 as "older than everything" is how
   * a fresh rejection got judged stale and dropped. */
  function recency(r) {
    return Math.max(Number(r.updatedSort || 0), Number(r.appliedSort || 0));
  }

  function isBlank(v) {
    return v == null || v === '' || v === '—' || v === 0;
  }

  /* Compare what the sweep found against what is already on the page.
   *
   *   rows      current rows, each optionally carrying `manual`: {field: true}
   *   incoming  rows from the sweep
   *   deleted   array of keys the person has deleted and does not want back
   *
   * Returns a report. Nothing is changed. */
  function diff(rows, incoming, deleted) {
    var byKey = {};
    (rows || []).forEach(function (r) { byKey[keyOf(r)] = r; });
    var gone = {};
    (deleted || []).forEach(function (k) { gone[k] = true; });

    var report = { added: [], changed: [], conflicts: [], skipped: [], unchanged: 0 };

    (incoming || []).forEach(function (inc) {
      var key = keyOf(inc);

      if (gone[key]) { report.skipped.push({ key: key, row: inc }); return; }

      var cur = byKey[key];

      /* Same role, and one employer name is the other with words added —
       * "Rivermead" and "Rivermead Group", "Corvi" and "Corvi Ltd". Boards and
       * trackers shorten names differently; without this the same application
       * lands twice. Whole words only, so "Corvi" never matches "Corvina". */
      if (!cur) {
        var co0 = slug(inc.company), stem0 = roleStem(inc.role);
        (rows || []).some(function (r) {
          var co1 = slug(r.company);
          if (!co0 || !co1 || roleStem(r.role) !== stem0 || gone[keyOf(r)]) return false;
          if (co1.indexOf(co0 + '-') === 0 || co0.indexOf(co1 + '-') === 0) {
            cur = r; key = keyOf(r); return true;
          }
          return false;
        });
      }

      /* No exact company+role match. Employers word the role differently in a
       * rejection than in the confirmation, or leave it out altogether, so
       * company+role misses exactly when it matters most and the outcome
       * lands as a duplicate new row. Before accepting that, look for a role
       * still open at the same employer. One candidate is an update to it;
       * more than one is a guess, so it falls through and is offered as a new
       * row as before. Either way the person still ticks it. */
      if (!cur && slug(inc.company) &&
          slug(inc.company) !== slug('(unknown employer)')) {
        var co = slug(inc.company);
        var mine = (rows || []).filter(function (r) {
          return slug(r.company) === co && !gone[keyOf(r)];
        });
        /* An open role is the better guess when there is one; failing that, a
         * single row for this employer is still a far better answer than a
         * second row for the same job under a slightly different title. Two or
         * more and it is a guess, so it falls through and is offered as new. */
        var open = mine.filter(function (r) { return r.status !== 'shut'; });
        var pick = open.length === 1 ? open[0] : (mine.length === 1 ? mine[0] : null);
        if (pick) { cur = pick; key = keyOf(cur); }
      }

      if (!cur) { report.added.push(inc); return; }

      var fields = [];
      SWEEP_FIELDS.forEach(function (f) {
        var to = inc[f], from = cur[f];
        if (isBlank(to) || String(to) === String(from)) return;
        if (PAIRED[f] && isBlank(inc[PAIRED[f]])) return;

        /* An older sweep must not walk a row backwards — judged on the
         * newest date either row carries, not on `updated` alone. */
        if (/^(updated|updatedSort|status|chip)$/.test(f) &&
            recency(inc) < recency(cur)) return;

        /* `applied` is when you applied, not when you heard back. A rejection
         * arrives as a thread of its own, so its first message is dated the
         * day of the decision — left alone, every outcome quietly restamped
         * the application date. Fill a blank, or correct one backwards when an
         * earlier confirmation turns up; never move it later. */
        if ((f === 'applied' || f === 'appliedSort') &&
            !isBlank(cur.appliedSort) &&
            Number(inc.appliedSort || 0) >= Number(cur.appliedSort || 0)) return;

        /* "Direct" is what the extractor says when it recognises no job board
         * — the weakest answer it has — and a curated "LinkedIn → Pinpoint"
         * records a hand-off whose back half is all the sweep ever sees.
         * Neither may overwrite a source already named on the page. */
        if (f === 'sourceLabel') {
          var named = !isBlank(from) && from !== 'Unknown' &&
                      String(from).toLowerCase().indexOf('no confirmation') < 0;
          if (named && (to === 'Direct' || String(from).indexOf('\u2192') > -1)) return;
        }

        /* Withdrawing is your decision, not the employer's. A later email —
         * a scheduling link, a "next steps" chaser sent before you pulled out —
         * must not quietly reopen it. */
        if ((f === 'status' || f === 'chip') && /withdr/i.test(String(cur.chip || ''))) return;

        /* An acknowledgement must not reopen a decided row. Employers send
         * "thank you for applying" boilerplate inside rejection mail, and a
         * thread read as `wait` should never undo an outcome already on the
         * page. */
        if ((f === 'status' || f === 'chip') &&
            inc.status === 'wait' && cur.status !== 'wait') return;

        fields.push({ field: f, from: from, to: to });
      });

      if (!fields.length) { report.unchanged++; return; }

      var mine = (cur.manual || {});
      function isMine(f){ return !!(mine[f] || (PAIRED[f] && mine[PAIRED[f]])); }
      var claimed = fields.filter(function (f) { return isMine(f.field); });
      var free = fields.filter(function (f) { return !isMine(f.field); });

      if (free.length) report.changed.push({ key: key, row: cur, incoming: inc, fields: free });
      if (claimed.length) report.conflicts.push({ key: key, row: cur, incoming: inc, fields: claimed });
    });

    return report;
  }

  /* Apply a report. `choices` decides what actually lands:
   *
   *   {add: true, change: true, conflicts: {'<key>::<field>': true}}
   *
   * Conflicts are opt-in one at a time; nothing there is applied by default. */
  function apply(rows, report, choices) {
    var opts = choices || {};
    var conflictPicks = opts.conflicts || {};
    var out = (rows || []).map(function (r) { return r; });
    var byKey = {};
    out.forEach(function (r, i) { byKey[keyOf(r)] = i; });

    var applied = { added: 0, changed: 0, conflicts: 0 };

    function write(entry, fields) {
      var i = byKey[entry.key];
      if (i == null) return 0;
      var copy = {};
      Object.keys(out[i]).forEach(function (k) { copy[k] = out[i][k]; });
      fields.forEach(function (f) { copy[f.field] = f.to; });
      MINE_ONLY.forEach(function (k) {
        if (out[i][k] !== undefined) copy[k] = out[i][k];
      });
      out[i] = copy;
      return fields.length;
    }

    if (opts.add !== false) {
      var skip = opts.skipAdded || {};
      report.added.forEach(function (r) {
        if (skip[keyOf(r)]) return;
        out.push(r);
        byKey[keyOf(r)] = out.length - 1;
        applied.added++;
      });
    }

    if (opts.change !== false) {
      var skipChanged = opts.skipChanged || {};
      report.changed.forEach(function (c) {
        if (skipChanged[c.key]) return;
        if (write(c, c.fields)) applied.changed++;
      });
    }

    report.conflicts.forEach(function (c) {
      var picked = c.fields.filter(function (f) {
        return conflictPicks[c.key + '::' + f.field];
      });
      if (picked.length && write(c, picked)) applied.conflicts++;
    });

    out.sort(function (a, b) {
      return (Number(b.appliedSort) || 0) - (Number(a.appliedSort) || 0);
    });

    return { rows: out, applied: applied };
  }

  /* Split additions into the ones worth trusting and the ones that could not
   * be named. Indeed's confirmations never carry the employer, so a sweep
   * always turns up a few — they are offered, not applied. */
  function partitionAdded(report) {
    var named = [], unnamed = [];
    report.added.forEach(function (r) {
      (r.needsReview ? unnamed : named).push(r);
    });
    return { named: named, unnamed: unnamed };
  }

  /* A one-line human summary of a report, for the toast. */
  function summarise(report) {
    var bits = [];
    var split = partitionAdded(report);
    if (split.named.length) bits.push(split.named.length + ' new');
    if (split.unnamed.length) bits.push(split.unnamed.length + ' unnamed');
    if (report.changed.length) bits.push(report.changed.length + ' updated');
    if (report.conflicts.length) bits.push(report.conflicts.length + ' needing a decision');
    if (report.skipped.length) bits.push(report.skipped.length + ' previously deleted');
    if (!bits.length) return 'Nothing new';
    return bits.join(', ');
  }

  var API = { keyOf: keyOf, roleStem: roleStem, diff: diff, apply: apply,
              partitionAdded: partitionAdded,
              summarise: summarise, SWEEP_FIELDS: SWEEP_FIELDS, MINE_ONLY: MINE_ONLY };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Merge = API;
})(typeof window !== 'undefined' ? window : globalThis);
