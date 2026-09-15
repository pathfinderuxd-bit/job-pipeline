#!/usr/bin/env node
/* Keep real application data out of anything that goes public.
 *
 *   node scripts/no-real-data.mjs apps/web/dist/index.html   check one build
 *   node scripts/no-real-data.mjs --tree                     check everything git tracks
 *
 * A hosted page and a public repo are both readable by anyone who finds them.
 * The hosted build ships sample rows only; each person imports their own after
 * signing in. Offline builds (apps/rb, apps/sb) are meant to carry real data
 * and are local-only, which is why their data files are gitignored.
 *
 * The names to watch for are read from whatever real data exists on this
 * machine, so this keeps working as the data changes. Two places carry it:
 * the row files themselves, and site.json — whose insight prose names
 * employers, which is exactly how it slipped through the first time.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const tree = args.includes('--tree');
const target = tree ? null : resolve(args[0] ?? 'apps/web/dist/index.html');

/* Every phrase that would identify someone's real job hunt. */
const needles = new Set();

const rowFiles = ['import-rich.json', 'import-stu.json',
                  'apps/rb/data/applications.json', 'apps/sb/data/applications.json'];
for (const rel of rowFiles) {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) continue;
  const parsed = JSON.parse(readFileSync(p, 'utf8'));
  for (const row of Array.isArray(parsed) ? parsed : (parsed.applications ?? [])) {
    if (row.company) needles.add(row.company);
    if (row.note && row.note.length > 20) needles.add(row.note);
  }
}

/* site.json prose, which names employers in the insight cards. */
for (const rel of ['apps/rb/data/site.json', 'apps/sb/data/site.json']) {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) continue;
  const site = JSON.parse(readFileSync(p, 'utf8'));
  for (const card of site.insights ?? []) {
    if (card.title) needles.add(card.title);
    if (card.body) needles.add(card.body);
  }
}

/* Generic board and ATS names live in the shared config; they identify nobody. */
const config = readFileSync(resolve(ROOT, 'packages/tracker/src/config.js'), 'utf8');
const rules = readFileSync(resolve(ROOT, 'packages/tracker/src/rules.json'), 'utf8');
const generic = (n) => config.includes(n) || rules.includes(n);

function scan(label, text) {
  return [...needles].filter((n) => n.length > 3 && !generic(n) && text.includes(n))
    .map((n) => ({ label, hit: n }));
}

let found = [];
if (tree) {
  let files;
  try {
    /* Tracked AND untracked-but-not-ignored. Scanning only what git already
     * tracks meant a new file was invisible until the commit that added it had
     * already been made — which is exactly how real employer names reached a
     * public repo once. A file is checked before it is committed, or the check
     * is theatre. */
    files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'],
                         { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch {
    console.log('Not a git checkout — nothing to scan.');
    process.exit(0);
  }
  for (const f of files) {
    const p = resolve(ROOT, f);
    if (!existsSync(p)) continue;
    let text;
    try { text = readFileSync(p, 'utf8'); } catch { continue; }
    found = found.concat(scan(f, text));
  }
} else {
  found = scan(target, readFileSync(target, 'utf8'));
}

if (!needles.size) {
  console.log('No real data on this machine to compare against — nothing to check.');
  process.exit(0);
}

if (found.length) {
  const where = tree ? 'Files git is tracking carry' : `${target} carries`;
  console.error(`${where} real application data:\n` +
    found.slice(0, 10).map((f) => `  · ${f.label}\n      ${f.hit.slice(0, 80)}`).join('\n') +
    (found.length > 10 ? `\n  …and ${found.length - 10} more` : '') +
    '\n\nGitignore the file, or take the identifying details out of it.');
  process.exit(1);
}
console.log(tree
  ? `Nothing git tracks carries real data (checked ${needles.size} identifying phrases).`
  : `${target}: no real application data baked in.`);
