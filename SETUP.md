# Setting up the hosted tracker

One page, hosted once. Whoever signs in sees their own rows, stored in their own
Google Drive. Rich signs in and gets Rich's; Stu signs in and gets Stu's.

You only do steps 1–3 once, between you. After that each person does step 5 on
their own machine.

---

## Before you start

**GitHub Pages is not a separate account or product.** It is a setting on a
repository you already have — Settings → Pages. Nothing to sign up for.

**A public repo is fine, and the page carries nothing of yours.** That is not
luck — `apps/web` is configured to ship only invented sample data, and the
deploy refuses to run if real rows ever get baked in
(`scripts/no-real-data.mjs`). Your actual applications reach the page one of two
ways, both after you have signed in as yourself: **Import a file** from an
export, or a first **Refresh from Gmail**. Either way they go to your Drive,
never to the repo.

Two things a public repo *does* mean, worth knowing rather than discovering:

- **The repo is findable.** Public repos are searchable on GitHub, indexed by
  Google, and listed on your profile. The Pages URL follows from the repo name.
  Nothing here relies on nobody finding it.
- **`apps/rb/data` and `apps/sb/data` are still committed and still real.** They
  are what the offline builds use, and in a public repo anyone reading the repo
  can read them. If that bothers you, delete those two files before you push and
  keep them locally — the hosted page never reads them anyway.

The page itself is `noindex`, and the deploy writes a `robots.txt` that asks
crawlers to stay out. That keeps it out of search results; it is not a lock.

If you want the committed baselines private as well, either pay for Pages on a
private repo, or host from a private repo somewhere with a free tier
(Cloudflare Pages and Netlify both allow this) — the build output is one static
HTML file, so anywhere that serves files will do. Or skip hosting entirely:
`npm run dev` serves the same page at `http://localhost:5176`, which works as an
OAuth origin. Then skip step 4.

---

## 1. Make a Google Cloud project

1. [console.cloud.google.com](https://console.cloud.google.com) → **Select a
   project** → **New project**. Call it anything; `job-pipeline` will do.
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. Same library → search **Google Drive API** → **Enable**.

## 2. Set up the consent screen

1. **APIs & Services → OAuth consent screen** → **External** → Create.
2. App name, your email for both support fields. Save.
3. **Scopes** → Add or remove scopes → add these two:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/drive.appdata`
4. **Test users** → add both Gmail addresses that will use this.
5. **Leave the app in Testing.** Do not click *Publish app*. `gmail.readonly` is
   a restricted scope: publishing it to the world requires a security assessment
   that costs real money. In Testing it is free and instant, capped at 100 test
   users. The only cost is that Google re-prompts periodically — which matters
   not at all, because this page asks you to sign in every visit anyway.

## 3. Create the client ID

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorised JavaScript origins** — add every origin the page is served from:
   - `http://localhost:5176` (for `npm run dev:web`)
   - `https://<your-github-username>.github.io` (for Pages)

   Origins only — no paths, no trailing slash.
4. Copy the client ID. It looks like `1234-abcd.apps.googleusercontent.com`.
5. Paste it into `apps/web/tracker.config.json`:

   ```json
   "googleClientId": "1234-abcd.apps.googleusercontent.com"
   ```

   **This is not a secret.** A browser OAuth client has no client secret — the
   ID is public by design, and the authorised-origins list is what stops anyone
   else using it. Commit it.

## 4. Turn on Pages

1. Push the repo to GitHub.
2. **Settings → Pages → Source: GitHub Actions**. That is the whole setting.
3. `.github/workflows/pages.yml` builds and deploys on every push to `main`. It
   runs the merge tests first and refuses to deploy a build with no client ID.
4. Your page lands at `https://<username>.github.io/<repo>/`.

If the repo name is not `<username>.github.io`, the site sits in a subpath. That
does not affect OAuth — the origin is still `https://<username>.github.io`.

## 5. First sign-in, per person

1. Open the page. Click **Sign in with Google**.
2. Pick the account. Because the app is in Testing you will see an
   *unverified app* warning — **Advanced → Go to (app name)**. That is expected
   and will keep appearing; it is the price of not paying for verification.
3. Grant both permissions.
4. You will be asked where to start:
   - **Import a file** — a JSON export from an offline build or another machine.
     This is how the rows already checked over by hand get in.
   - **Sample data** — invented rows, for a look round.
   - **Start empty** — sweep the mailbox and build from nothing.

   To bring your curated rows across, build your offline app first
   (`npm run build:rb`), open it, click **Export**, then import that file here.
   You only do this once; after that the hosted page loads from Drive.
5. From then on the page loads your rows straight from Drive.

## 6. Day to day

**Refresh from Gmail** asks Google for permission again, reads your mail, and
shows you what it found before anything lands:

- **new** — applications not on the page yet
- **updated** — a status the mailbox knows about and the page does not
- **needing a decision** — where the mailbox disagrees with something you set by
  hand. Nothing here is applied unless you tick it.

**Cancel changes nothing.** Apply merges. Your stars, cover letters, job
descriptions and CV choices are never touched by a refresh, whatever arrives.

Edits save to this browser instantly and to Drive a couple of seconds later —
you will see *Saving to Google Drive…* then *Saved*. **Export** gives you the
whole thing as a JSON file, which is worth doing occasionally regardless.

---

## Rescuing edits from the old artifact

Edits made in the Claude artifact versions live in that page's own browser
storage, which a page on a different address cannot read. They will not appear
automatically.

The committed baselines already carry the curation that matters — the notes,
the corrections, the flags. What is stranded is only what you changed *in the
browser* after that: stars, cover letters, job descriptions, statuses you
flipped by hand.

Edits made in an *earlier local build* on the same address are a different
matter — the page finds those and offers to bring them in on first sign-in.

---

## When it goes wrong

**"This build has no Google client ID yet"** — step 3, and rebuild.

**`redirect_uri_mismatch` or `origin_mismatch`** — the origin you are on is not
in the authorised list. Check for a trailing slash, and that `http://localhost`
is not written as `https://`.

**The sign-in popup closes instantly** — popups are blocked for the page. Allow
them and click again.

**"Could not reach Google sign-in"** — usually a content blocker stopping
`accounts.google.com`. The page still works; it just cannot sign you in.

**Sign-in works, Drive does not** — the Drive API is not enabled (step 1.3), or
`drive.appdata` is missing from the consent screen (step 2.3). Your edits are
safe in the browser meanwhile; the page says so.

**Refresh finds nothing** — the sweep looks back `sweepMonths` (6 by default) and
only at senders listed in `packages/tracker/src/rules.json`. Add a domain there
and rebuild.

**Refresh gets a company or role wrong** — also `rules.json`. That file is built
to be corrected; it is the first place to look, and the node importer in
`packages/gmail-import` uses exactly the same rules, so a fix helps both.

---

## Trying it without any of this

```bash
npm run dev:web
```

then open `http://localhost:5176/?demo=1` — or `npm run dev:preview` and
`http://localhost:5177`, which is the same thing with the stand-in baked in.
That swaps Google for a local stand-in — a pretend account, a pretend sweep, a pretend Drive — so you can walk
the whole flow, including the refresh diff and the undo, without a Google
project and without touching any real mail.
