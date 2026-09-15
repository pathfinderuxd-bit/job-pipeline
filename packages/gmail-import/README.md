# gmail-import

Sweeps a mailbox for job applications and writes `data/applications.json` for one app.

## Read-only, by construction

The only scope requested is `gmail.readonly`. A token with that scope cannot send,
reply, draft, label, archive or delete — the Gmail API refuses those calls. If you
ever find yourself needing a wider scope, that is a sign the tool has grown into
something it should not be.

## One-time setup

1. [Google Cloud Console](https://console.cloud.google.com) → new project.
2. **APIs & Services → Library → Gmail API → Enable.**
3. **APIs & Services → OAuth consent screen** → External → add the mailbox owner
   as a test user.
4. **Credentials → Create credentials → OAuth client ID → Desktop app.** Download
   the JSON and save it as `packages/gmail-import/credentials.json`.

Both `credentials.json` and the cached `.token.json` are gitignored. They are
per-person: Stuart's copy of the repo gets his own, signed in as him.

## Running it

```bash
npm install --workspace packages/gmail-import
node packages/gmail-import/src/import.mjs --app apps/sb --months 6 --dry-run
node packages/gmail-import/src/import.mjs --app apps/sb --months 6
node packages/tracker/bin/build.mjs apps/sb
```

`--dry-run` prints what it found and writes nothing. Without it, the existing
`applications.json` is copied to a timestamped backup first.

| flag | default | meaning |
| --- | --- | --- |
| `--app` | `apps/sb` | which app's data to write |
| `--months` | `6` | how far back to sweep |
| `--credentials` | `packages/gmail-import/credentials.json` | OAuth client |
| `--token` | `packages/gmail-import/.token.json` | cached refresh token |
| `--dry-run` | off | report only |

## What it gets wrong

Roughly what you would expect, and it says so rather than hiding it. Any row it
is unsure about comes back with `"needsReview": true`:

- **Indeed does not name the employer** in its confirmation emails. The extractor
  falls back to a capitalised-phrase guess from the body, which is often wrong.
- **Applications that never generate an email** — some boards confirm on-screen
  only — leave no trace at all. Cross-check against the boards' own "applied"
  lists before you trust the count.
- **Auto-appliers** (Adzuna ApplyIQ and friends) look identical to applications
  the person made themselves, and can duplicate them.
- **Rejections that quote the original acknowledgement** can read as both. The
  rules in `rules.json` are ordered so rejection wording wins; add to that list
  when you hit a phrasing it misses.

`rules.json` is where all of this is tuned — sender domains, status phrases,
contract-type words, subject patterns. It is plain JSON on purpose: it is the
file to hand Claude Code when the extraction is wrong.
