#!/usr/bin/env node
/* The other scanner checks what the repo looks like NOW. This one checks what
 * it has ever looked like, because a public repo does not forget.
 *
 * That distinction is not academic: the working tree was cleaned on 14 Sep and
 * reported clean every day after, while twelve commits of real application data
 * sat in the history behind it, already pushed.
 *
 *   node scripts/no-real-data-history.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

/* The needles come from the local data files — the ones that are gitignored
 * precisely because they are real. */
const needles = new Set();
for (const f of ['apps/rb/data/applications.json', 'apps/sb/data/applications.json']) {
  const p = resolve(ROOT, f);
  if (!existsSync(p)) continue;
  for (const row of JSON.parse(readFileSync(p, 'utf8'))) {
    const c = String(row.company || '').trim();
    if (c && c.length > 3 && !/^\(/.test(c)) needles.add(c);
  }
}

if (!needles.size) {
  console.log('No local data to compare against — nothing to check.');
  process.exit(0);
}

const commits = git('rev-list', '--all').trim().split('\n').filter(Boolean);
console.log(`Checking ${commits.length} commits against ${needles.size} employer names…\n`);

const hits = new Map();
for (const n of needles) {
  let out = '';
  try { out = git('grep', '-lI', '-F', n, ...commits); } catch (e) { continue; }
  for (const line of out.trim().split('\n').filter(Boolean)) {
    const [sha, ...rest] = line.split(':');
    const path = rest.join(':');
    if (!hits.has(sha)) hits.set(sha, new Set());
    hits.get(sha).add(path);
  }
}

if (!hits.size) {
  console.log('Clean. No commit reachable from any ref carries a real employer name.');
  process.exit(0);
}

console.log(`${hits.size} commit(s) carry real application data:\n`);
for (const [sha, paths] of hits) {
  console.log(`  ${git('log', '-1', '--format=%h %s', sha).trim()}`);
  for (const p of [...paths].sort()) console.log(`      ${p}`);
}
console.log(`
This cannot be fixed by editing files. The commits have to go — a history
rewrite, or a fresh repository. And if these were ever pushed to a public
remote, treat them as published: rewriting hides them from the branch, it
does not remove them from the host.`);
process.exit(1);
