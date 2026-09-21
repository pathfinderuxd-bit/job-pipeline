# Working in this repo

## How the owner wants this done

- **Be concise.** Short answers. No restating the plan, no summarising what was
  just said, no listing everything that was considered. Findings, then the next
  action.
- **Walk through anything operational one step at a time.** One instruction,
  wait, next. Do not hand over a numbered list of nine things.
- **Only ask a question when the answer changes what happens next.** Otherwise
  pick the sensible option, say which in one line, and carry on.
- **Never push, and never commit without being asked.** Show what changed and
  wait.
- **Never send email.** Gmail access is read-only and stays that way.
- Real application data never reaches the repo or the hosted page.

Read `README.md` first — it covers the layout, the data shape and how to build.
This file is the stuff that isn't obvious from reading the code.

## The shape of it

`packages/tracker` is the app. `apps/*` are data only. If you find yourself
copying a file from one app into another, stop: it belongs in the package.

There are two build shapes, set by `mode` in an app's `tracker.config.json`.
**offline** bakes the data in and renders at load; **hosted** starts empty behind
a Google sign-in. Both come out as one self-contained HTML file.

Script order is fixed in `bin/build.mjs` and matters:

1. `TRACKER_CONFIG`
2. `src/config.js` — `SRC_BADGE`, `TYPE_ICONS`, `CV_OPTIONS`, `CV_SEED`
3. `window.BUILD` — version, app, theme, mode, build time; drawn as the badge
   under the masthead
4. the data — `window.APPLICATIONS` (offline) or `window.BASELINES` + `RULES` (hosted)
5. `src/merge.js` — pure, no DOM
6. hosted only: `store.js`, `toast.js`, `extract.js`, `google.js`
7. `src/cvstore.js` then `src/cvui.js` — the CV library. Both must load before
   render.js, which asks `cvOptionsHtml()` for the contents of every CV
   dropdown as it draws the rows.
8. `src/render.js` — writes the `<tbody>`, masthead and insight cards
9. `src/app.js` — defines `window.TrackerApp`, which reads rows out of the DOM
10. hosted only: `src/gate.js` — drives sign-in, then calls `Render.all()` and `TrackerApp()`

An offline build sets `window.__BOOT_NOW` in render.js and app.js boots itself at
the bottom. A hosted build does not, and waits for gate.js.

## Four statuses, not three

`live` / `wait` / `lead` / `shut`. A **lead** is something worth applying to that
has not been applied to yet — it is in the table so it can be acted on, but it
is not an application, so it never counts as one. It sorts below the live rows
and above what is closed, and it takes the blue both themes already carry for
insights, so it reads as *outside the pipeline* rather than as a warmer or
cooler version of applied. Adding another status means touching `RANK` in
render.js, `RANKJS` and `STATUS_OPTIONS` in app.js, the tally row in shell.html,
the counts in `apply()`, and the allow-list in `bin/check.mjs`.

## Needs chasing

Derived, never stored: days since `updatedSort || appliedSort`, for rows that
are still `live` or `wait`. A lead was never applied to and a closed one is
finished, so neither can go stale. The age badge is written into the Updated
cell, which means anything that rewrites that cell must also
`removeAttribute('data-base')` or the badge will be appended to a stale value.

That cell is also read back when a row is saved, so read it through
`updShownOf()` in app.js and never `textContent` — otherwise the badge is saved
*into* the date and the next render appends another one. Two rows reached
`24 Aug22d22d22d` before this was caught.

## Adding a row by hand

A hand-added row is keyed `new-<timestamp>` and its content lives only in
`doc.rows` — it is never written into `doc.applications`. `currentRows()` in
gate.js adopts any such orphan back into the list; without that step every row
added by hand disappears on the next reload. If you change how rows are stored,
keep the adoption.

`+ Add` draws a blank row with `Render.rowHtml` — the same renderer as every
other row, so it carries the same attributes and the same delegated handlers —
inserts it, and opens the editor with `adding` set. Cancel *and* Esc both go
through the dialog's `close` event, which throws the row away; submitting clears
`adding` first so the same handler leaves it alone.

**paste-to-fill** parses the pasted text here in the page. No network, no model.
It is wrong sometimes by design: it fills the form and the person corrects it,
rather than writing a row behind their back. It cannot read a screenshot — a
static page has no OCR — and that limit is deliberate, not a to-do.

## The Gmail sweep

Two passes. The first finds applications from the wording, the boards and
applicant trackers in `sources`, and `is:starred`. **No label is used to find
mail** — filtering in by label cost more real mail than it caught. The second
pass takes every employer on the page, closed ones included, and queries Gmail
for their mail directly, narrowed by job words, eight employers to a query.

One label *excludes*: `excludeLabels` in rules.json (currently `Job Alerts`),
and only if that label exists in the mailbox — the sweep asks Gmail for the
label list first and drops any that are not there.

The owner's `whitelist` and `blacklist` are case-insensitive and *weighed*:
each list scores once in the subject (×3) and once in the body (×1), whitelist
adding and blacklist (plus `ignoreSubjects`) subtracting; below zero is junk.
Once per place, not per word — "see new", "new jobs" and "see new jobs" are one
signal, or the real LinkedIn confirmation (whose body says "View job" and "See
new jobs") would be outvoted. A whitelist hit with no status wording reads as
Awaiting; the status rules still decide the outcome. `test/corpus.json` is what
says whether a change to any of this is safe.

What an applied refresh changes goes into `doc.alerts` (newest per row, capped
at 60). Unseen alerts put a red dot on the row and a count on the bell; the
bell's list opens a row exactly as its ⋯ does, and opening a row either way
marks it seen.

Cast wide, then let `extract.js` decide. It has read the thread; a Gmail query
has only read a subject line.

**There is no sender blocklist and there must not be one.** The same LinkedIn
address sends "your application was sent to X" and "Acme is hiring"; the same
Indeed address sends employer decisions and job alerts. That list lost real mail
three separate times before it was removed.

Gmail label search takes the full path — `JOBS/LinkedIn`, not `LinkedIn` — and a
parent label does **not** include its children. Two label queries silently
matched nothing for weeks because of this.

Never exclude confirmations or acknowledgements. Those *are* the evidence the
gate looks for. Filtering them out does not remove noise, it removes the record.

`test/corpus.json` is the specification: real emails, renamed, each labelled
acknowledgement / outcome / neither. Change a rule and run `npm test`. When
something is classified wrongly, the fix is to add that email to the corpus
first.

## The CV library

`cvstore.js` keeps the files in IndexedDB and, when signed in, a copy of each
one plus the index in the same hidden Drive folder the applications back up to.
That is what makes the library follow you between machines; a build with no
Google keeps everything on the one machine and still works.

`cvui.js` owns the CV column dropdown. The last group in it is three actions,
not three CVs — `__cv_open__`, `__cv_upload__`, `__cv_library__` — and app.js
puts the select back to the row's real value before running any of them, so a
cancelled upload never changes which CV an application went out with.

The library itself is routed at `#cv-library` rather than being its own page.
It looks like a page and the back button works, but it stays in the one
document on purpose: a second page would mean a second sign-in dance to upload
one file.

A CV is soft-deleted, like a row. It drops out of the dropdown but stays
readable, marked `(deleted)`, on the applications that used it — which CV went
out is a fact about something that already happened.

`app.js` takes its state from the DOM, not from a model. It reads
`#tb tr` once on start-up, and every feature after that — sort, filter, column
move, column resize, show/hide, the row editor — works by reading and writing
`data-*` attributes on those `<tr>` elements. So:

- **Rows must exist before `app.js` runs.** That is why `render.js` is inlined
  ahead of it rather than fetched.
- **A new field means a new `data-` attribute**, set in `render.js`'s `rowHtml`,
  read wherever it is needed, and written back in `persist()`.
- Column identity is the `data-col` on the `<th>` and the matching `c-*` class
  on each `<td>`. Show/hide and reordering both key off that, which is why they
  survive each other.

## Themes

`src/themes/v1.css` and `v2.css` are complete, independent stylesheets over the
same markup. v2 is the shadcn-flavoured one and the default. Adding a rule to
one and not the other is the single easiest mistake to make here — if you touch
a component's styles, touch both files.

Both define a light palette on bare `:root`, then redefine tokens under
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` and
again under `:root[data-theme="dark"]`. A colour whose only definition lives
inside a media block is a bug.

## Conventions worth keeping

- No dependencies in the app. No framework, no bundler, no CDN at runtime except
  the Google Fonts stylesheet (which has a real fallback stack behind it).
- ES5-flavoured `var`/`function` inside `app.js`, because it is one long IIFE
  and mixing styles halfway through reads badly. `build.mjs`, `check.mjs` and
  the importer are modern ESM — different files, different rules.
- Markup is built by string concatenation with an `esc()` on every value that
  came from data. Badge and icon markup is trusted HTML from `config.js` and is
  deliberately *not* escaped; anything from `applications.json` always is.
- `npm run check` before you call something done. It builds all three apps and
  asserts the output is self-contained, parses, and has no malformed rows.

## The v3 pieces

- **`merge.js` is pure and tested** (`npm test`). No DOM, no storage, no
  network. Anything you add to the refresh behaviour belongs here, with a test,
  not in gate.js.
- **A field set by hand is the person's.** `store.markManual(id, field)` records
  it; the merge then reports it as a conflict rather than overwriting it. When
  you add a new way to edit a row, call `markManual` from it, or a later refresh
  will quietly stamp on the edit.
- **`TrackerApp.reload(rows)` replaces the row set without a page reload.** Use
  it rather than `location.reload()`: it is instant, and it keeps scroll, sort
  and filter state. It works because every row handler is delegated
  from the table element, so nothing is bound per row.
- **`?demo=1` swaps Google for a local stand-in** at the bottom of google.js —
  a pretend account, sweep and Drive. It is how the flow is tested without a
  Google project. Keep it working; it is the only way to exercise gate.js
  headlessly.
- **Scopes are `gmail.readonly` and `drive.appdata`, and stay that way.** The
  check script asserts no wider Gmail scope appears in a build.
- **The access token lives in `sessionStorage`, for the life of the tab.** That
  is the only thing stored: no refresh token, nothing that outlives the tab.
  `Google.resume()` picks it up on boot so a refresh does not cost a sign-in,
  and every read and write of it is wrapped, because the accessors throw in a
  private window. Google expires it after about an hour anyway.
- **Deleting is undoable for nine seconds** and records a merge key in
  `doc.deleted` so a later sweep does not re-add the row. Undo removes that key
  again.

## Things that will bite

- **Empty data is a supported state.** `apps/sb` ships with `[]`. The carousel,
  the CV dropdown in the editor and the live list all have guards for it — keep
  them.
- **Offline builds have only `localStorage`** — per browser, per device, lost
  when site data is cleared. The hosted build adds Drive on top; offline does
  not, deliberately, so it keeps working with no account at all.
- **The LinkedIn badge is their actual mark**, inlined as a base64 PNG in
  `config.js`. Every other badge is plain initials on purpose.
- **Page-initiated downloads don't work inside a Claude artifact.** That is why
  the cover-letter panel has a Copy button and not a "save as .txt". If you add
  a download, it will work locally and silently do nothing when published.
- `appliedSort`/`updatedSort` are what sorting uses. Change a date and you must
  change both it and its display string, or the table sorts by one and shows the
  other.

## Gmail

`packages/gmail-import` requests `gmail.readonly` and nothing else. Do not widen
that scope. Any feature that would need send, reply, draft, label or delete
access does not belong in this repo.

## Search

The filter bar leads with a search box (`#q`, `filters.q` in app.js). Every
word must match, in any case, accents ignored; "quoted" is a phrase; a leading
minus excludes; `company: role: via: type: status: note: date:` narrow a word
to one column. The index is the row's own textContent plus the status words
for its `data-s`, so there is nothing extra to keep in sync. `/` focuses it,
Esc clears it, and Clear filters clears it with everything else.

## Case

Every match in the sweep ignores case: keyword lists, ignoreSubjects, status
phrases, subject patterns, JOBS/* label names, and the lead-in words the
extractor looks for. The one exception is on purpose — the captured employer or
role must start with a capital, because that is all that tells "at Rivermead"
from "at the moment". A whole-pattern /i flag loses that; the lead-in words are
spelled out as [Aa][Tt] via ci() instead.
