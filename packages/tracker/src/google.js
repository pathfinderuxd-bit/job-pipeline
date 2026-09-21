/* google.js — sign in, read the mailbox, keep a copy in Drive.
 *
 * The access token is held in sessionStorage, so it survives a refresh and
 * dies when the tab closes. Nothing else is kept: no refresh token, no
 * password, and nothing at all once the tab is gone. Google expires the token
 * after about an hour regardless, so a long session still signs in again.
 *
 * The scopes:
 *   gmail.readonly   read messages. Cannot send, reply, label or delete —
 *                    the API refuses those calls with this token.
 *   drive.appdata    a hidden folder in your own Drive that only this app can
 *                    see. It cannot read or write anything else you own.
 */
(function (root) {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var GIS = 'https://accounts.google.com/gsi/client';
  var SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/drive.appdata'
  ].join(' ');

  /* sessionStorage, not localStorage: scoped to this one tab and wiped when it
   * closes. Every access goes through these two, because the accessors throw
   * in a private window and on a page with site data blocked. */
  var TOKEN_KEY = 'job-pipeline/gtoken';

  function remembered() {
    try {
      var raw = sessionStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      /* Google's tokens last about an hour. A minute of margin means a sweep
       * does not start on a token that expires halfway through it. */
      if (!o || !o.token || !o.expires || Date.now() > o.expires - 60000) return null;
      return o;
    } catch (e) { return null; }
  }

  function remember(tok, account, expiresIn) {
    try {
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify({
        token: tok, account: account || null,
        expires: Date.now() + (Number(expiresIn) || 3600) * 1000
      }));
    } catch (e) { /* private window, or site data blocked — carry on in memory */ }
  }

  function forget() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  var saved = remembered();
  var token = saved ? saved.token : null;
  var account = saved ? saved.account : null;   // the address the token belongs to
  var clientId = '';
  var loading = null;

  function loadGIS() {
    if (window.google && window.google.accounts) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = GIS;
      s.async = true;
      s.onload = res;
      s.onerror = function () {
        rej(new Error('Could not reach Google sign-in. Check the connection, ' +
                      'or that an extension is not blocking accounts.google.com.'));
      };
      document.head.appendChild(s);
    });
    return loading;
  }

  function configure(id) { clientId = id || ''; }
  function configured() { return !!clientId; }
  function currentAccount() { return account; }
  function signedIn() { return !!token; }

  function signOut() {
    token = null;
    account = null;
    forget();
  }

  /* Ask Google for a token. `select_account consent` means the account chooser
   * appears every time, so switching from Rich to Stu is just picking the other
   * one — there is nothing cached to clear first. */
  function requestToken() {
    if (!clientId) {
      return Promise.reject(new Error(
        'No Google client ID configured. Put one in tracker.config.json — see SETUP.md.'));
    }
    return loadGIS().then(function () {
      return new Promise(function (res, rej) {
        var client = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPES,
          prompt: 'select_account consent',
          callback: function (resp) {
            if (resp && resp.access_token) {
              token = resp.access_token;
              remember(token, account, resp.expires_in);
              res(token);
            }
            else rej(new Error('Sign-in did not complete.'));
          },
          error_callback: function (err) {
            rej(new Error(err && err.type === 'popup_closed'
              ? 'Sign-in window was closed.'
              : 'Sign-in failed. If a popup was blocked, allow popups for this page.'));
          }
        });
        client.requestAccessToken();
      });
    });
  }

  function api(url, opts) {
    var o = opts || {};
    var headers = o.headers || {};
    headers.Authorization = 'Bearer ' + token;
    return fetch(url, {
      method: o.method || 'GET',
      headers: headers,
      body: o.body
    }).then(function (r) {
      if (r.ok) return o.raw ? r.text() : r.json();

      /* Google says why in the body. Passing that through beats a guess —
       * the three that actually happen are a stale token, a scope the person
       * did not tick on the consent screen, and an API left disabled. */
      return r.text().then(function (body) {
        var detail = '';
        try { detail = (JSON.parse(body).error || {}).message || ''; } catch (e) { detail = ''; }
        var api = url.indexOf('gmail') > -1 ? 'Gmail' : 'Drive';

        if (r.status === 401) {
          signOut();
          throw new Error('Google rejected the sign-in token. Sign in again.' +
                          (detail ? ' (' + detail + ')' : ''));
        }
        if (r.status === 403) {
          if (/has not been used|is disabled|not enabled/i.test(detail)) {
            throw new Error('The ' + api + ' API is not enabled on your Google Cloud project. ' +
                            'Enable it, wait a minute, then try again. (' + detail.slice(0, 160) + ')');
          }
          if (/insufficient|scope|permission/i.test(detail)) {
            signOut();
            throw new Error('The sign-in did not grant read access to ' + api + '. ' +
                            'Google shows a tick box per permission and they start unticked — ' +
                            'sign in again and tick both. (' + detail.slice(0, 160) + ')');
          }
          throw new Error('Google refused the ' + api + ' request: ' + (detail || '403'));
        }
        if (r.status === 429) throw new Error('Google is rate-limiting the sweep. Wait a minute and try again.');
        throw new Error('Google returned ' + r.status + ' from ' + api + (detail ? ': ' + detail : ''));
      });
    });
  }

  /* Which mailbox does this token belong to? gmail.readonly covers it, so
   * identifying the person costs no extra permission. */
  function whoAmI() {
    return api('https://gmail.googleapis.com/gmail/v1/users/me/profile')
      .then(function (p) {
        account = p.emailAddress;
        /* Re-stamp the stored entry now the address is known, so a refresh
         * knows who it is without spending a call to find out. */
        var o = remembered();
        if (o) remember(token, account, Math.round((o.expires - Date.now()) / 1000));
        return account;
      });
  }

  /* Pick up where the last page load left off, if the tab still holds a live
   * token. Resolves to null when there is nothing to resume — that is the
   * ordinary first visit, not an error. The profile call doubles as the check
   * that Google still honours the token. */
  function resume() {
    var o = remembered();
    if (!o) return Promise.resolve(null);
    token = o.token;
    account = o.account;
    return whoAmI().catch(function () { signOut(); return null; });
  }

  function signIn() {
    return requestToken().then(whoAmI);
  }

  /* ------------------------------------------------------------- Gmail -- */

  function listThreadIds(query) {
    var ids = {};
    function page(tok) {
      var url = 'https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=100&q=' +
                encodeURIComponent(query) + (tok ? '&pageToken=' + tok : '');
      return api(url).then(function (d) {
        (d.threads || []).forEach(function (t) { ids[t.id] = true; });
        return d.nextPageToken ? page(d.nextPageToken) : Object.keys(ids);
      });
    }
    return page(null);
  }

  function header(headers, name) {
    var hit = (headers || []).filter(function (h) {
      return h.name.toLowerCase() === name;
    })[0];
    return hit ? hit.value : '';
  }

  function decode(data) {
    try {
      var b64 = String(data).replace(/-/g, '+').replace(/_/g, '/');
      return decodeURIComponent(escape(atob(b64)));
    } catch (e) { return ''; }
  }

  function bodyText(part) {
    if (!part) return '';
    if (part.mimeType === 'text/plain' && part.body && part.body.data) return decode(part.body.data);
    return (part.parts || []).map(bodyText).join('\n');
  }

  function getThread(id) {
    return api('https://gmail.googleapis.com/gmail/v1/users/me/threads/' + id + '?format=full')
      .then(function (d) {
        return (d.messages || []).map(function (m) {
          var h = m.payload && m.payload.headers;
          return {
            threadId: id,
            sender: header(h, 'from'),
            subject: header(h, 'subject'),
            date: new Date(Number(m.internalDate)),
            body: bodyText(m.payload).slice(0, 4000)
          };
        });
      });
  }

  /* Sweep the mailbox and hand back rows. onProgress(done, total) drives the
   * progress line in the refresh dialog. */
  function sweep(opts) {
    var o = opts || {};
    var rules = o.rules || window.RULES || { sources: {}, status: [], types: {},
                                             subjectPatterns: [], ignoreSenders: [], ignoreSubjects: [] };
    var months = o.months || 6;
    var since = new Date();
    since.setMonth(since.getMonth() - months);
    var after = since.getFullYear() + '/' + (since.getMonth() + 1) + '/' + since.getDate();

    /* One label excludes, and only if it exists. A query naming a label the
     * mailbox does not have is at best ignored and at worst matches nothing,
     * so ask Gmail which labels are there first and drop any that are not.
     * No label is used to *find* mail any more: filtering in by label cost
     * more real mail than it caught. */
    var base, queries;
    function prepare() {
      var wanted = (rules.excludeLabels || []).map(function (l) { return String(l).trim(); })
                                              .filter(Boolean);
      var check = wanted.length
        ? api('https://gmail.googleapis.com/gmail/v1/users/me/labels').then(function (d) {
            var have = {};
            (d.labels || []).forEach(function (l) { have[String(l.name).toLowerCase()] = true; });
            return wanted.filter(function (l) { return have[l.toLowerCase()]; });
          }, function () { return []; })
        : Promise.resolve([]);
      return check.then(function (present) {
        var not = present.map(function (l) {
          return ' -label:"' + l.replace(/"/g, '').replace(/\s+/g, '-') + '"';
        }).join('');
        base = 'after:' + after + ' in:anywhere' + not + ' ';

        /* Pass one: find applications — the wording, the boards and trackers
         * they come from, and your star. The gate in extract.js has the final
         * say, having read the thread. */
        queries = [base + '(subject:application OR subject:applying ' +
                   'OR subject:applied OR subject:"thank you for your interest" ' +
                   'OR subject:interview OR "thanks for applying" OR "on this occasion")'];
        Object.keys(rules.sources).forEach(function (d) {
          queries.push(base + 'from:' + d);
        });
        queries.push(base + 'is:starred');
      });
    }

    /* Job words, for narrowing pass two. Plenty of agencies are named after
     * ordinary nouns, and without these an employer whose name is a common
     * word drags in half the mailbox. */
    var JOB_WORDS = '(application OR applying OR applied OR candidacy OR ' +
                    'interview OR shortlisted OR role OR position)';

    var seen = {};
    var rows = [];
    var done = 0, expected = 0;

    function tell(stage) {
      if (o.onProgress) o.onProgress(done, Math.max(expected, done), stage);
    }

    /* Read a batch of threads, four at a time: fast enough, and well inside
     * Gmail's rate limits. */
    function readAll(ids, stage) {
      var queue = ids.slice();
      expected += queue.length;
      tell(stage);
      function worker() {
        if (!queue.length) return Promise.resolve();
        var id = queue.pop();
        return getThread(id).then(function (messages) {
          var row = window.Extract.threadToApplication(messages, rules);
          if (row) rows.push(row);
        }, function () { /* one unreadable thread must not sink the sweep */ })
          .then(function () { done++; tell(stage); return worker(); });
      }
      return Promise.all([worker(), worker(), worker(), worker()]);
    }

    function gather(qs, stage) {
      var found = [];
      return qs.reduce(function (chain, q) {
        return chain.then(function () {
          return listThreadIds(q).then(function (ids) {
            ids.forEach(function (id) {
              if (!seen[id]) { seen[id] = true; found.push(id); }
            });
          }, function () { /* a query Gmail dislikes must not sink the sweep */ });
        });
      }, Promise.resolve()).then(function () { return readAll(found, stage); });
    }

    return prepare().then(function () {
      return gather(queries, 'finding applications');
    }).then(function () {
      /* Pass two: chase the follow-ups. Pass one finds the acknowledgement
       * because it is worded like one and filed like one; the rejection that
       * comes six weeks later is often neither — no label, no star, a subject
       * that never says "application". But by now we know the employer's name,
       * so we can go and ask for it directly. This is the pass that catches
       * "we have decided not to proceed" and "invite you to interview".
       *
       * Every row on the page is chased, closed ones included — an employer
       * does sometimes come back. */
      var want = {};
      function consider(r) {
        if (!r) return;
        var name = String(r.company || '').trim();
        if (!name || name.charAt(0) === '(' || name.length < 3) return;
        want[name.toLowerCase()] = name;
      }
      rows.forEach(consider);
      (o.known || []).forEach(consider);

      var names = Object.keys(want).map(function (k) { return want[k]; }).slice(0, 80);
      if (!names.length) return;

      /* Eight employers per query. One query per employer would be eighty
       * round trips; Gmail's OR syntax turns that into ten. */
      var qs = [];
      for (var i = 0; i < names.length; i += 8) {
        var group = names.slice(i, i + 8).map(function (n) {
          return '"' + n.replace(/["\\]/g, '') + '"';
        }).join(' OR ');
        qs.push(base + '(' + group + ') ' + JOB_WORDS);
      }
      return gather(qs, 'checking for replies');
    }).then(function () {
      rows.sort(function (a, b) { return (b.appliedSort || 0) - (a.appliedSort || 0); });
      return rows;
    });
  }

  /* Everything from one employer, for the check button on a row. Same
   * read-only token as the sweep: it can look, and that is all it can do. */
  function findFor(company, months) {
    var since = new Date();
    since.setMonth(since.getMonth() - (months || 6));
    var after = since.getFullYear() + '/' + (since.getMonth() + 1) + '/' + since.getDate();
    var term = String(company || '').replace(/["\\]/g, '').trim();
    if (!term) return Promise.resolve([]);

    return listThreadIds('after:' + after + ' in:anywhere "' + term + '"').then(function (ids) {
      return Promise.all(ids.slice(0, 8).map(function (id) {
        return getThread(id).then(function (msgs) {
          var last = msgs[msgs.length - 1];
          if (!last) return null;
          return {
            subject: last.subject || '(no subject)',
            sender: last.sender || '',
            when: last.date.getUTCDate() + ' ' + MONTHS[last.date.getUTCMonth()],
            at: last.date.getTime()
          };
        }, function () { return null; });
      }));
    }).then(function (found) {
      return found.filter(Boolean).sort(function (a, b) { return b.at - a.at; });
    });
  }

  /* ------------------------------------------------------------- Drive -- */

  /* Everything lives in appDataFolder — a hidden folder inside your own Drive
   * that only this app can see. It cannot read or write anything else you own,
   * and it does not count against the files you can browse.
   *
   * Two shapes go in there: small JSON documents (the applications, the CV
   * index) and the CV files themselves, which are binary and have to be
   * handled differently.
   */

  var FILE = 'job-pipeline.json';
  var ids = {};                      // filename -> Drive file id, looked up once

  function find(name) {
    if (ids[name]) return Promise.resolve(ids[name]);
    var url = 'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder' +
              '&fields=files(id,modifiedTime)&q=' + encodeURIComponent("name='" + name + "'");
    return api(url).then(function (d) {
      ids[name] = (d.files && d.files[0] && d.files[0].id) || null;
      return ids[name];
    });
  }

  function jsonLoad(name) {
    return find(name).then(function (id) {
      if (!id) return null;
      return api('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media', { raw: true })
        .then(function (text) {
          try { return JSON.parse(text); } catch (e) { return null; }
        });
    });
  }

  function jsonSave(name, doc) {
    var body = JSON.stringify(doc);
    return find(name).then(function (id) {
      if (id) {
        return api('https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media',
                   { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body })
          .then(function () { return { id: id }; });
      }
      var boundary = 'jp' + Date.now();
      var meta = { name: name, parents: ['appDataFolder'] };
      var payload =
        '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(meta) + '\r\n' +
        '--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n' +
        '--' + boundary + '--';
      return api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
                 { method: 'POST',
                   headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
                   body: payload })
        .then(function (d) { ids[name] = d.id; return { id: d.id }; });
    });
  }

  function driveLoad() { return jsonLoad(FILE); }
  function driveSave(doc) { return jsonSave(FILE, doc); }

  /* A CV is a PDF or a Word file. The multipart body has to be assembled as a
   * Blob, not a string — concatenating binary into JavaScript text mangles it,
   * and the file that came back down would not open. */
  function blobUpload(name, mime, blob) {
    var boundary = 'jp' + Date.now() + Math.random().toString(36).slice(2);
    var meta = { name: name, parents: ['appDataFolder'] };
    var body = new Blob([
      '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(meta) + '\r\n',
      '--' + boundary + '\r\nContent-Type: ' + mime + '\r\n\r\n',
      blob,
      '\r\n--' + boundary + '--'
    ]);
    return api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
               { method: 'POST',
                 headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
                 body: body })
      .then(function (d) { return d.id; });
  }

  /* Deliberately not api(): that parses JSON, and this comes back as bytes. */
  function blobDownload(id) {
    return fetch('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media',
                 { headers: { Authorization: 'Bearer ' + token } })
      .then(function (r) {
        if (r.status === 401) { signOut(); throw new Error('Google rejected the sign-in token. Sign in again.'); }
        if (!r.ok) throw new Error('Drive would not hand that file back (' + r.status + ').');
        return r.blob();
      });
  }

  function blobRemove(id) {
    return api('https://www.googleapis.com/drive/v3/files/' + id, { method: 'DELETE', raw: true });
  }

  root.Google = {
    configure: configure, configured: configured,
    signIn: signIn, signOut: signOut, signedIn: signedIn, resume: resume,
    account: currentAccount, sweep: sweep, findFor: findFor,
    drive: { load: driveLoad, save: driveSave },
    files: { loadJson: jsonLoad, saveJson: jsonSave,
             upload: blobUpload, download: blobDownload, remove: blobRemove }
  };

  /* ---------------------------------------------------------------- demo --
   *
   * ?demo=1 swaps Google out for a local stand-in: a pretend account, a
   * pretend sweep, and a Drive that is really just a second localStorage key.
   * It exists so the whole flow — sign in, choose a starting point, refresh,
   * read the diff, apply it — can be walked through and tested without a
   * Google Cloud project. It touches no real mail and no real Drive.
   */
  if (/[?&]demo=1/.test(location.search) ||
      (root.TRACKER_CONFIG && root.TRACKER_CONFIG.demo)) {
    var DEMO_ACCOUNT = 'demo@example.com';
    var DEMO_KEY = 'job-pipeline/demo-drive';

    root.Google.configured = function () { return true; };
    root.Google.signedIn = function () { return !!account; };
    root.Google.account = function () { return account; };
    root.Google.signOut = function () { account = null; };
    root.Google.signIn = function () {
      account = DEMO_ACCOUNT;
      return new Promise(function (res) { setTimeout(function () { res(account); }, 150); });
    };

    root.Google.findFor = function (company) {
      return new Promise(function (res) {
        setTimeout(function () {
          res([{ subject: 'Thank you for applying to ' + company, sender: 'careers@example.com',
                 when: '15 Sep', at: Date.now() },
               { subject: 'Your application is with the hiring team', sender: 'careers@example.com',
                 when: '12 Sep', at: Date.now() - 3 * 86400000 }]);
        }, 250);
      });
    };

    root.Google.sweep = function (opts) {
      var o = opts || {};
      var seed = (root.Tracker && root.Tracker.applications()) ||
                 (root.BASELINES && root.BASELINES.demo && root.BASELINES.demo.rows) || [];
      var found = seed.slice(0, 3).map(function (r) {
        var c = {}; Object.keys(r).forEach(function (k) { c[k] = r[k]; });
        return c;
      });
      /* one genuinely new row, and one outcome on a row you already have */
      found.push({ status: 'wait', chip: 'Awaiting', company: 'Larkspur Systems',
                   role: 'Delivery Lead — remote', type: 'Full-Time',
                   source: 'Workable', sourceLabel: 'Workable',
                   applied: '14 Sep', appliedSort: 20260914,
                   updated: '—', updatedSort: 0, note: '' });
      if (found[0]) {
        found[0] = Object.assign({}, found[0], {
          status: 'shut', chip: 'Not shortlisted',
          updated: '15 Sep', updatedSort: 20260915
        });
      }
      if (o.onProgress) { o.onProgress(0, found.length); o.onProgress(found.length, found.length); }
      return new Promise(function (res) { setTimeout(function () { res(found); }, 200); });
    };

    /* The CV library in demo mode: the index is a localStorage key and the
     * files never leave IndexedDB, which is where CVStore keeps them anyway. */
    var DEMO_FILES = 'job-pipeline/demo-drive/';
    root.Google.files = {
      loadJson: function (name) {
        return new Promise(function (res) {
          setTimeout(function () {
            try { res(JSON.parse(localStorage.getItem(DEMO_FILES + name) || 'null')); }
            catch (e) { res(null); }
          }, 80);
        });
      },
      saveJson: function (name, doc) {
        return new Promise(function (res) {
          setTimeout(function () {
            try { localStorage.setItem(DEMO_FILES + name, JSON.stringify(doc)); } catch (e) {}
            res({ id: 'demo-' + name });
          }, 80);
        });
      },
      upload: function (name) {
        return new Promise(function (res) { setTimeout(function () { res('demo-' + name); }, 120); });
      },
      download: function () {
        return Promise.reject(new Error('This CV is only on the machine it was uploaded from.'));
      },
      remove: function () { return Promise.resolve(''); }
    };

    root.Google.drive = {
      load: function () {
        return new Promise(function (res) {
          setTimeout(function () {
            try { res(JSON.parse(localStorage.getItem(DEMO_KEY) || 'null')); }
            catch (e) { res(null); }
          }, 100);
        });
      },
      save: function (doc) {
        return new Promise(function (res) {
          setTimeout(function () {
            try { localStorage.setItem(DEMO_KEY, JSON.stringify(doc)); } catch (e) {}
            res({ id: 'demo' });
          }, 150);
        });
      }
    };
  }
})(window);
