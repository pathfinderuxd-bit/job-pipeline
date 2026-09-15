# job-pipeline

A job application tracker. One app, one dataset per person.

Each person's tracker builds to a single self-contained HTML file — CSS, JS,
data and the LinkedIn mark all inlined. It opens from the filesystem, drops onto
any static host, and can be published as a Claude artifact unchanged. No
bundler, no framework, no dependencies for the app itself.

```
job-pipeline/
├── packages/
│   ├── tracker/            the app — shell, themes, renderer, behaviour, build
│   └── gmail-import/       read-only Gmail sweep from the command line
└── apps/
    ├── web/                hosted: one page, sign in as yourself
    ├── preview/            the hosted page with Google stood in locally
    ├── rb/                 Rich — offline build, his data baked in
    ├── sb/                 Stu — offline build, his data baked in
    └── blank/              showcase build on invented data
```

An app is *only* data and config — nothing else. They all build from the same
source, so a fix to the tracker lands everywhere at once.

**Two shapes**, chosen by `mode` in each app's `tracker.config.json`:

- **offline** (rb, sb, blank) — the data is baked in, the page renders the
  moment it opens, and it works from the filesystem with no sign-in. This is
  what you publish as an artifact or email to someone.
- **hosted** (web) — the page starts empty behind a Google sign-in, loads
  whoever signs in, keeps their rows in their own Drive, and can refresh itself
  from Gmail. `SETUP.md` walks through standing it up.

**Read `QUICKSTART.md` to run it, `SETUP.md` to host it.**

## Getting going

Requires Node 20+. Nothing to install for the app itself.

```bash
npm run build          # every app → apps/*/dist/index.html
npm run build:rb       # just one
npm run dev            # the hosted app on :5176, rebuilds on every refresh
npm run dev:rb         # :5173   an offline build
npm test               # the merge tests
npm run check          # tests, then build everything and check the output
```

Open `apps/rb/dist/index.html` in a browser and that is the whole offline app.

For the hosted one, `npm run dev` then `http://localhost:5176/?demo=1` walks the
entire flow — sign in, pick a starting point, refresh, read the diff, undo a
delete — against a local stand-in, with no Google project and no real mail.

## The data

`data/applications.json` is an array. One object per application:

```json
{
  "status": "live",
  "applied": "8 Sep",
  "appliedSort": 20260908,
  "company": "Northwind Labs",
  "role": "Senior Product Designer",
  "type": "Full-Time",
  "source": "LinkedIn",
  "sourceLabel": "LinkedIn",
  "updated": "9 Sep",
  "updatedSort": 20260909,
  "chip": "Interview",
  "note": "Thu 18 Sep, 10:00"
}
```

| field | notes |
| --- | --- |
| `status` | `live`, `wait` or `shut` — drives the dot colour and the three tabs |
| `applied` / `updated` | what the cell shows; `"—"` for unknown |
| `appliedSort` / `updatedSort` | `YYYYMMDD` as a number, `0` for unknown. Sorting uses these, not the display string |
| `type` | one of the keys in `TYPE_ICONS` (config.js) |
| `source` | must match a key in `SRC_BADGE`, or the badge falls back to `?` |
| `sourceLabel` | the visible text — `"Indeed → Recruitee"` where a board handed off to an ATS |
| `chip` | the words on the status pill: `Interview`, `Awaiting`, `Not shortlisted`… |
| `note` | the grey second line under the role |
| `cv` | optional; otherwise seeded from `type` via `CV_SEED` |

`data/site.json` holds the masthead and the insight cards. `{{N}}`, `{{LIVE}}`,
`{{WAIT}}`, `{{SHUT}}` and `{{UPDATED}}` are substituted at render time, so the
prose never drifts from the data. An empty `insights` array hides the carousel.

`tracker.config.json` picks the theme (`v1` green-grey, `v2` shadcn stone) and
the `localStorage` key, which is per-app so two trackers on one host don't
collide.

## What's stored where

Three layers, each doing one job:

| layer | holds | lifetime |
| --- | --- | --- |
| the repo | the curated baselines | versioned in git, read-only at runtime |
| `localStorage` | the working copy | this browser, this machine |
| Google Drive | your live rows | follows you to any device, survives a wiped browser |

In an **offline** build there is no Drive: edits live in `localStorage` alone,
so they are one browser deep and gone if site data is cleared.

**The hosted build ships no real data.** A hosted page is public — whatever is
baked into it is readable in the page source before anyone signs in — so
`apps/web` carries only the invented sample rows, and
`scripts/no-real-data.mjs` fails the deploy if that ever stops being true. Real
applications arrive per person, after sign-in, by importing an export or running
a first Gmail sweep. The committed baselines in `apps/rb/data` and
`apps/sb/data` are for the offline builds only.

In the **hosted** build, edits write to `localStorage` instantly and to a hidden
per-user folder in your own Drive a couple of seconds later — and again when the
tab goes away. The folder is one Google gives each app; this page cannot see
anything else you own. **Export** hands you the lot as a JSON file, which is
worth doing occasionally whatever else is in place.

## Refreshing from Gmail

`packages/tracker/src/merge.js` is the part that matters, and it is tested:

- an application not on the page is **added**
- a status the mailbox knows about and the page does not is **updated**
- a field *you* set by hand is a **conflict** — listed, never applied unless you
  tick it
- stars, cover letters, job descriptions and CV choice are **never touched**
- a row you deleted does not come back
- an older sweep cannot walk a row backwards

Two ways to feed it: the **Refresh from Gmail** button in the hosted build, or
`packages/gmail-import` from the command line. Both run the same extractor and
the same rules, in `packages/tracker/src/`.

## Filling in a mailbox

`packages/gmail-import` does a read-only sweep (`gmail.readonly`, which cannot
send or delete) and writes an `applications.json`. See its README — the setup is
a Google Cloud OAuth client, one per person, and the extraction rules live in a
plain `rules.json` built to be corrected.

It will get things wrong. Indeed's confirmations don't name the employer;
some applications never generate an email at all. Cross-check against the boards
themselves before trusting a number.
