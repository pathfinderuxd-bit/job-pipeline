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

  /* The vocabulary of an application. Nothing without one of these words is a
   * row, whatever else it says. */
  var JOBBISH = /\b(applicat|applying|applied|candidacy|candidate|shortlist|interview|vacancy|\brole\b|\bposition\b|recruit)/i;

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

  /* Subjects only, by design. A sender tells you nothing: the address that
   * sends "your application was sent to X" is the same one that sends "Few&Far
   * is hiring". Blocking senders lost real confirmations three separate times.
   * This is a cheap first pass over unambiguous digest wording; the decision
   * that matters is made further down, having read the thread. */
  function isNoise(msg, rules) {
    var subject = String(msg.subject || '').toLowerCase();
    return (rules.ignoreSubjects || []).some(function (s) { return subject.indexOf(s) > -1; });
  }

  /* Case-insensitive, typographic quotes flattened — the same treatment the
   * status rules get, so a list entry behaves the same wherever it lives. */
  function flat(text) {
    return String(text || '').toLowerCase()
      .replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"');
  }
  function listHit(list, text) {
    var hay = flat(text);
    return (list || []).some(function (w) { return w && hay.indexOf(flat(w)) > -1; });
  }

  function statusFor(text, rules) {
    /* Employers write "won't be moving forward" with a typographic
     * apostrophe. Matched against a straight-quoted rule that is simply a
     * different character, and the rejection reads as an acknowledgement. */
    var hay = String(text || '').toLowerCase()
      .replace(/[\u2018\u2019\u02BC]/g, "'")
      .replace(/[\u201C\u201D]/g, '"');
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

    /* "Sam Alder - Calder IT" is a recruiter writing from calderit.<ats>.com.
     * The display name is half person, half employer, and taking it whole puts
     * a person's name in the company column — where it matches no existing row
     * and becomes a duplicate. If one part of the name is the employer the
     * domain already names, that part is the answer. */
    var host = domainOf(sender).split('.')[0];
    if (host && /[-|,\u2013\u2014]/.test(name)) {
      var pick = name.split(/\s*[-|,\u2013\u2014]\s*/).filter(function (part) {
        return slugish(part) && slugish(part) === slugish(host);
      })[0];
      if (pick) return pick.trim();
    }

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

  /* "at the Rivermead Group" names the Rivermead Group, not the Rivermead
   * Group preceded by an article. */
  function slugish(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function tidyName(s) {
    return String(s || '').replace(/^\s*the\s+/i, '').replace(/\s+/g, ' ').trim();
  }

  /* A rejection often names the role only in the body — the subject is just
   * "Your application to <employer>". Reading the body is the difference
   * between landing the outcome on the right row and inventing a new one. */
  function roleFromBody(body) {
    var text = String(body || '');
    var m = text.match(/\b(?:role|position) of\s+([^.\n]{3,80}?)\s+(?:at|with)\b/i) ||
            text.match(/\bthe\s+([A-Z][^.\n]{3,80}?)\s+(?:position|role)\b/);
    return m ? m[1].trim() : '';
  }

  /* Two passes, most reliable first. "at" and "with" are how an employer is
   * normally named; "joining X" and "interest in X" are the other common
   * shapes, kept separate because a bare "in" would happily return "London". */
  function companyFromBody(body) {
    var text = String(body || '');
    var NAME = "([A-Z][\\w&.'-]*(?:\\s+[A-Z][\\w&.'-]*){0,3})";
    var tries = [
      new RegExp("\\b(?:at|with|to)\\s+(?:the\\s+)?" + NAME + "\\b"),
      new RegExp("\\b(?:joining|interest in|career at)\\s+(?:the\\s+)?" + NAME + "\\b"),
    ];
    for (var i = 0; i < tries.length; i++) {
      var m = text.match(tries[i]);
      /* The name can run past the end of its sentence — "Rivermead Group. We
       * appreciate..." — because a full stop is legal inside an abbreviated
       * name. Cut at the first sentence break. */
      if (m) return m[1].split(/\.\s/)[0].replace(/[.,;:]+$/, '').trim();
    }
    return '';
  }

  /* Last resort: the sender's own domain. A recruiter writing from
   * redgatesearch.co.uk is Redgate Search. Skipped for the job boards and applicant
   * trackers in rules.sources, whose domain names the tool, not the employer. */
  function companyFromDomain(sender, rules) {
    var d = domainOf(sender);
    if (!d) return '';
    var known = Object.keys(rules.sources).some(function (dom) {
      return d === dom || d.slice(-(dom.length + 1)) === '.' + dom;
    });
    if (known) return '';
    var label = d.split('.')[0];
    if (!label || label.length < 3 || /^\d/.test(label)) return '';
    if (/^(mail|email|smtp|no.?reply|notifications?|info|hello|careers?|jobs?|apply|talent|hire|hiring|recruit\w*)$/i.test(label)) return '';
    return label.charAt(0).toUpperCase() + label.slice(1);
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
    if (!first) return null;

    /* The owner's own lists, in this order of precedence:
     *   1. a whitelist phrase in the subject keeps the thread, whatever else;
     *   2. a blacklist word in the subject drops it — those are the digests;
     *   3. a whitelist phrase in the body keeps what is left.
     * Letting a body hit beat a blacklisted subject let digests through: an
     * alert's small print says "make your application stand out", a match
     * nag says "based on your application history". The corpus has both. */
    var all = ordered.map(function (m) { return m.subject + '\n' + (m.body || ''); }).join('\n');
    var subjWhite = listHit(rules.whitelist, first.subject);
    var black = listHit(rules.blacklist, first.subject) || isNoise(first, rules);
    if (black && !subjWhite) return null;
    var white = subjWhite || listHit(rules.whitelist, all);

    /* Before any of the wording rules get a vote: is this even about a job?
     * "unsuccessful" is the word a rejection uses and also the word a declined
     * card payment uses, and no amount of tuning the rejection phrases fixes
     * that — the thread simply has to be about an application first. */
    if (!white && !JOBBISH.test(first.subject + '\n' + (first.body || ''))) return null;

    var source = sourceFor(first.sender, rules);
    var parsed = parseSubject(first.subject, rules);

    /* Three goes at naming the employer, best first: the subject line, the
     * sender's display name, then a guess from the body. Indeed genuinely does
     * not name the employer anywhere, so some threads reach the end unnamed —
     * those come back flagged rather than confidently wrong. */
    var company = parsed.company;
    if (!company) company = companyFromSender(first.sender, rules);
    if (!company) company = companyFromBody(first.body);
    if (!company) company = companyFromDomain(first.sender, rules);

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
    /* A whitelist phrase with no status wording around it still proves an
     * application: count it as awaiting, dated from the first message. */
    if (!outcome && white) { outcome = { status: 'wait', chip: 'Awaiting' }; outcomeAt = first.date; }
    if (!outcome) return null;

    var final = outcome;
    var role = parsed.role;

    /* "Your application to the Rivermead Group" parses as a role, because the
     * pattern behind it reads "Your application to <role>" and cannot tell a
     * role from an employer. If the body names the same employer, the subject
     * was naming the company all along — drop the role and find a real one. */
    if (role && company && tidyName(role).toLowerCase() === tidyName(company).toLowerCase()) {
      role = '';
    }
    if (!role) role = roleFromBody(first.body);
    company = tidyName(company);

    /* When the outcome is a decision rather than an acknowledgement, its date
     * is real news even if it arrived as a thread of its own — which is how
     * almost every rejection arrives. Tying `updated` to "did this thread run
     * to more than one message" left every one-message rejection dated '—',
     * and a row dated '—' cannot out-rank the row it is meant to update. */
    var moved = outcomeAt && (outcomeAt > first.date || final.status !== 'wait');

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
    tidyName: tidyName, roleFromBody: roleFromBody,
    companyFromBody: companyFromBody, companyFromDomain: companyFromDomain,
    statusFor: statusFor, typeFor: typeFor, parseSubject: parseSubject,
    displayDate: displayDate, sortDate: sortDate,
    threadToApplication: threadToApplication
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Extract = API;
})(typeof window !== 'undefined' ? window : globalThis);
