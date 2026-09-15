# Running it

Node 20 or newer. Nothing to install — the app has no dependencies.

```bash
unzip job-pipeline.zip
cd job-pipeline
git checkout v3
```

## Just look at it

```bash
npm run build:rb
open apps/rb/dist/index.html          # Windows: start   Linux: xdg-open
```

That is Rich's tracker, 40 rows, working offline with no sign-in and no
account. `npm run build:sb` does the same for Stu's. Double-clicking the file
works too — it is one self-contained HTML file.

## Try the hosted version without setting anything up

```bash
npm run dev:preview
```

Then open **http://localhost:5177**. Google is stood in for locally: a pretend
account, a pretend mailbox, a pretend Drive. Nothing real is touched. Walk the
whole thing —

1. **Sign in (demo)**
2. pick **Sample data**
3. star a couple of rows, watch the Starred section appear
4. delete a row, then hit **Undo** in the toast
5. click a company pill, paste anything, close it — the border goes solid
6. **Refresh from Gmail** → read the diff → **Cancel** (nothing changes) → do it
   again → **Apply changes**

That is exactly what the real thing does, minus Google.

## Run it for real, locally

Needs the Google client ID from `SETUP.md` steps 1–3 in
`apps/web/tracker.config.json`, with `http://localhost:5176` as an authorised
origin.

```bash
npm run dev            # http://localhost:5176
```

## Deploy it

`SETUP.md` step 4 — push to GitHub, Settings → Pages → Source: GitHub Actions.

## Everything else

```bash
npm run build          # every app
npm test               # the merge tests — 12 of them
npm run check          # tests, then build everything and check the output
npm run import:gmail -- --app apps/sb --months 6 --dry-run
```

## In Claude Code

```bash
cd job-pipeline && claude
```

`CLAUDE.md` at the root explains the architecture — the script order, how
`app.js` keeps state in `data-*` attributes, why both themes need touching
together, and what will bite. For data-only work, `cd apps/sb && claude` scopes
the session to that folder.

Good first asks:

- *"The refresh got a company name wrong — fix the rule in
  `packages/tracker/src/rules.json`"*
- *"Add a chase reminder: flag rows with no reply after 14 days"*
- *"Run `npm run check` and fix whatever fails"*
