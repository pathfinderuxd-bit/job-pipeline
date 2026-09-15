/* extract.js — turn Gmail threads into application rows.
 *
 * One implementation, two callers: the browser refresh button and the node
 * importer in packages/gmail-import. It is a plain script rather than a module
 * so both can load it; node does so by evaluating it with a stand-in window.
 *
 * The rules it works from live in rules.json and are meant to be edited. When
 * the extraction gets something wrong, that file is almost always the fix.
 */
(function (root) {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function domainOf(sender) {
    var m = String(sender || '').match(/@([^>\s]+)/);
    return m ? m[1].toLowerCase() : '';
  }

  function sourceFor(sender, rules) {
    var d = domainOf(sender), hit = 'Unknown';
    Object.keys(rules.sources).forEach(function (domain) {
      if (d === domain || d.slice(-(domain.length + 1)) === '.' + domain) {
        hit = rules.sources[domain];
      }
    });
    return hit;
  }

  function isNoise(msg, rules) {
    var from = String(msg.sender || '').toLowerCase();
    var noisy = rules.ignoreSenders.some(function (s) { return from.indexOf(s.toLowerCase()) > -1; });
    if (noisy) return true;
    var subject = String(msg.subject || '').toLowerCase();
    return rules.ignoreSubjects.some(function (s) { return subject.indexOf(s) > -1; });
  }

  function statusFor(text, rules) {
    var hay = String(text || '').toLowerCase();
    for (var i = 0; i < rules.status.length; i++) {
      var rule = rules.status[i];
      for (var j = 0; j < rule.match.length; j++) {
        if (hay.indexOf(rule.match[j]) > -1) return { status: rule.status, chip: rule.chip };
      }
    }
    return null;
  }

  function typeFor(role, rules) {
    var hay = String(role || '').toLowerCase(), found = 'Full-Time';
    Object.keys(rules.types).forEach(function (type) {
      if (found !== 'Full-Time') return;
      if (rules.types[type].some(function (w) { return hay.indexOf(w) > -1; })) found = type;
    });
    return found;
  }

  /* The employer is very often the sender's own display name —
   * "Halden Foods Careers <...>" or "Corvi <no-reply@greenhouse...>".
   * Not when the sender is the job board itself: Indeed is not the employer. */
  function companyFromSender(sender, rules) {
    var m = String(sender || '').match(/^\s*"?([^"<]+?)"?\s*</);
    if (!m) return '';
    var name = m[1].trim();

    var boards = [];
    Object.keys(rules.sources).forEach(function (d) {
      if (boards.indexOf(rules.sources[d]) < 0) boards.push(rules.sources[d]);
    });
    if (boards.some(function (b) { return name.toLowerCase() === b.toLowerCase(); })) return '';

    name = name.replace(
      /\s*[-–—|,:]?\s*(careers?|recruit(ment|ing)?|talent( team| acquisition)?|hiring( team)?|jobs?|hr( team)?|people( team)?|no.?reply|do.?not.?reply|notifications?|team|applications?)\s*$/i,
      '').trim();

    if (name.length < 2 || name.length > 60) return '';
    if (/^(no.?reply|do.?not.?reply|notifications?|info|admin|support|contact|hello|team|jobs?|careers?|mail(er)?|alerts?)$/i.test(name)) return '';
    if (name.indexOf('@') > -1) return '';
    return name;
  }

  function parseSubject(subject, rules) {
    for (var i = 0; i < rules.subjectPatterns.length; i++) {
      var m = String(subject || '').match(new RegExp(rules.subjectPatterns[i]));
      if (m && m.groups) {
        var role = String(m.groups.role || '').trim().replace(/\s*[-–—]\s*$/, '');
        var company = String(m.groups.company || '').trim();
        if (role || company) return { role: role, company: company };
      }
    }
    return { role: '', company: '' };
  }

  function displayDate(d) {
    return d ? (d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]) : '—';
  }

  function sortDate(d) {
    if (!d) return 0;
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return Number('' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()));
  }

  /* Fold one thread into a row. The oldest message is the application; the
   * newest carrying a status word is the outcome. */
  function threadToApplication(messages, rules) {
    var ordered = (messages || []).slice().sort(function (a, b) { return a.date - b.date; });
    var first = ordered[0];
    if (!first || isNoise(first, rules)) return null;

    var source = sourceFor(first.sender, rules);
    var parsed = parseSubject(first.subject, rules);

    /* Three goes at naming the employer, best first: the subject line, the
     * sender's display name, then a guess from the body. Indeed genuinely does
     * not name the employer anywhere, so some threads reach the end unnamed —
     * those come back flagged rather than confidently wrong. */
    var company = parsed.company;
    if (!company) company = companyFromSender(first.sender, rules);
    if (!company) {
      var m = String(first.body || '')
        .match(/\b(?:at|with|to)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})\b/);
      company = m ? m[1].trim() : '';
    }

    var outcome = null, outcomeAt = null;
    ordered.forEach(function (msg) {
      var hit = statusFor(msg.subject + '\n' + (msg.body || ''), rules);
      if (!hit) return;
      if (hit.status !== 'wait') { outcome = hit; outcomeAt = msg.date; }
      else if (!outcome) { outcome = hit; outcomeAt = outcomeAt || msg.date; }
    });

    /* The gate that matters. A thread only counts as an application if
     * something in it actually says so — an acknowledgement, a rejection, an
     * interview invitation. Without that it is a job alert, a "you appeared in
     * 4 searches", a newsletter; previously every one of those became an
     * Awaiting row with no employer against it. */
    if (!outcome) return null;

    var final = outcome;
    var role = parsed.role;
    var moved = outcomeAt && outcomeAt > first.date;

    /* Mail straight from an employer's own careers system is a direct
     * application, not an unknown one. Only a thread we cannot even name is
     * worth anyone's attention. */
    if (source === 'Unknown' && company) source = 'Direct';

    return {
      status: final.status,
      applied: displayDate(first.date),
      appliedSort: sortDate(first.date),
      company: company || '(unknown employer)',
      role: role || first.subject || '(unknown role)',
      type: typeFor(role, rules),
      source: source,
      sourceLabel: source,
      updated: moved ? displayDate(outcomeAt) : '—',
      updatedSort: moved ? sortDate(outcomeAt) : 0,
      chip: final.chip,
      note: '',
      needsReview: !company || !role,
      threadId: first.threadId
    };
  }

  var API = {
    domainOf: domainOf, sourceFor: sourceFor, isNoise: isNoise,
    companyFromSender: companyFromSender,
    statusFor: statusFor, typeFor: typeFor, parseSubject: parseSubject,
    displayDate: displayDate, sortDate: sortDate,
    threadToApplication: threadToApplication
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Extract = API;
})(typeof window !== 'undefined' ? window : globalThis);
