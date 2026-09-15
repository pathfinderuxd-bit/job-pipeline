#!/usr/bin/env node
/* Sweep a mailbox for job applications and write an applications.json.
 *
 *   node packages/gmail-import/src/import.mjs --app apps/sb --months 6
 *
 * Read-only: the OAuth scope is gmail.readonly, so this cannot send, reply,
 * draft, label or delete anything. Rows it is unsure about come out with
 * needsReview so you can fix them by hand (or in the app) rather than trust
 * a guess.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorise, gmailFor } from './auth.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const appDir = resolve(arg('app', 'apps/sb'));
const months = Number(arg('months', 6));
const dry = process.argv.includes('--dry-run');
const credentials = resolve(arg('credentials', join(PKG, 'credentials.json')));
const tokenPath = resolve(arg('token', join(PKG, '.token.json')));

/* The extractor and its rules live in packages/tracker/src, because the
 * browser refresh button runs exactly the same code. It is a plain script
 * rather than a module so both can load it; here that means evaluating it
 * with a stand-in window. */
const TRACKER = resolve(PKG, '../tracker/src');
const rules = JSON.parse(readFileSync(join(TRACKER, 'rules.json'), 'utf8'));
const { threadToApplication } = (() => {
  const win = {};
  new Function('window', 'module', readFileSync(join(TRACKER, 'extract.js'), 'utf8'))(win, undefined);
  return win.Extract;
})();

const since = new Date();
since.setMonth(since.getMonth() - months);
const after = `${since.getFullYear()}/${since.getMonth() + 1}/${since.getDate()}`;

// One query per source domain keeps each result set small and easy to audit.
const domains = Object.keys(rules.sources);
const queries = [
  `after:${after} in:anywhere (subject:"application" OR subject:"applying" OR subject:"applied")`,
  ...domains.map((d) => `after:${after} in:anywhere from:${d}`),
];

const gmail = gmailFor(await authorise(credentials, tokenPath));

async function threadIds(q) {
  const ids = new Set();
  let pageToken;
  do {
    const { data } = await gmail.users.threads.list({ userId: 'me', q, maxResults: 100, pageToken });
    (data.threads ?? []).forEach((t) => ids.add(t.id));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return ids;
}

const all = new Set();
for (const q of queries) {
  const ids = await threadIds(q);
  console.log(`${ids.size.toString().padStart(4)}  ${q}`);
  ids.forEach((id) => all.add(id));
}
console.log(`\n${all.size} unique threads to read\n`);

function header(headers, name) {
  return headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';
}

function bodyText(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64').toString('utf8');
  }
  return (part.parts ?? []).map(bodyText).join('\n');
}

const rows = [];
let n = 0;
for (const id of all) {
  const { data } = await gmail.users.threads.get({ userId: 'me', id, format: 'full' });
  const messages = (data.messages ?? []).map((m) => ({
    threadId: id,
    sender: header(m.payload?.headers, 'from'),
    subject: header(m.payload?.headers, 'subject'),
    date: new Date(Number(m.internalDate)),
    body: bodyText(m.payload).slice(0, 4000),
  }));
  const row = threadToApplication(messages, rules);
  if (row) rows.push(row);
  if (++n % 25 === 0) console.log(`  read ${n}/${all.size}`);
}

rows.sort((a, b) => b.appliedSort - a.appliedSort);

const review = rows.filter((r) => r.needsReview);
console.log(`\n${rows.length} applications, ${review.length} need a human look:`);
review.slice(0, 20).forEach((r) => console.log(`  · ${r.company} — ${r.role} (${r.source})`));

if (dry) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

const out = join(appDir, 'data/applications.json');
mkdirSync(dirname(out), { recursive: true });
if (existsSync(out)) {
  writeFileSync(out.replace(/\.json$/, `.backup-${Date.now()}.json`), readFileSync(out));
}
writeFileSync(out, JSON.stringify(rows, null, 2) + '\n');
console.log(`\nWrote ${out}\nNow: node packages/tracker/bin/build.mjs ${appDir}`);
