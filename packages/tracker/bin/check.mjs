#!/usr/bin/env node
/* Build every app and check the output holds together. No dependencies.
 *
 *   npm run check
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const BUILD = join(ROOT, 'packages/tracker/bin/build.mjs');
const APPS = ['apps/web', 'apps/preview', 'apps/rb', 'apps/sb', 'apps/blank'];

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

for (const app of APPS) {
  const dir = join(ROOT, app);
  console.log(`\n${app}`);
  if (!existsSync(join(dir, 'tracker.config.json'))) { check('has tracker.config.json', false); continue; }

  execFileSync(process.execPath, [BUILD, dir], { stdio: 'pipe' });

  const html = readFileSync(join(dir, 'dist/index.html'), 'utf8');
  const cfg = JSON.parse(readFileSync(join(dir, 'tracker.config.json'), 'utf8'));
  const site = existsSync(join(dir, 'data/site.json'))
    ? JSON.parse(readFileSync(join(dir, 'data/site.json'), 'utf8'))
    : { title: 'Job Pipeline' };
  const hosted = cfg.mode === 'hosted';
  // A hosted app carries several baselines instead of one dataset.
  const data = hosted
    ? Object.values(cfg.baselines ?? {}).flatMap(
        (b) => JSON.parse(readFileSync(resolve(dir, b.from), 'utf8')))
    : (existsSync(join(dir, 'data/applications.json'))
        ? JSON.parse(readFileSync(join(dir, 'data/applications.json'), 'utf8'))
        : []);

  check('builds', true);
  /* The page inlines everything bar its home-screen assets, which have to be
   * real files beside index.html: iOS will not reliably take an
   * apple-touch-icon as a data URI, and a manifest cannot resolve relative
   * icon paths from one. Both are named here rather than waved through by
   * pattern, so nothing else can slip in as a relative URL. */
  const SIBLINGS = ['apple-touch-icon.png', 'manifest.webmanifest'];
  const stray = [...html.matchAll(/(?:src|href)="(?!data:|https:\/\/fonts\.)([^"]*)"/g)]
    .map((m) => m[1]).filter((u) => !SIBLINGS.includes(u));
  check('self-contained (bar the home-screen icon and manifest)',
    stray.length === 0, stray.join(', '));
  check('exactly one style block and one script block',
    (html.match(/<style>/g) ?? []).length === 1 && (html.match(/<script>/g) ?? []).length === 1);

  const js = html.match(/<script>\n([\s\S]*?)\n<\/script>/)?.[1] ?? '';
  let parses = true;
  try { new Function(js); } catch (e) { parses = false; check('inline JS parses', false, e.message); }
  if (parses) check('inline JS parses', true);

  check('data is an array', Array.isArray(data));
  const bad = data.filter((d) => !['live', 'wait', 'lead', 'shut'].includes(d.status));
  check('every row has a known status', bad.length === 0, `${bad.length} bad`);
  const missing = data.filter((d) => !d.company || !d.role);
  check('every row has a company and a role', missing.length === 0, `${missing.length} incomplete`);
  check('site.json has a title', typeof site.title === 'string' && site.title.length > 0);
  check('data is embedded', /window\.(APPLICATIONS|BASELINES) = /.test(html));
  if (hosted) {
    check('sign-in gate is present', /mode:"hosted"|"mode":"hosted"/.test(html) && html.includes('gate-signin'));
    check('the merge, store and toasts are inlined',
      html.includes('window.Merge') && html.includes('TrackerStore') && html.includes('root.Toast'));
    check('scopes are read-only mail plus the private Drive folder',
      html.includes('gmail.readonly') && html.includes('drive.appdata') &&
      !/gmail\.(send|modify|compose)/.test(html));
  }

  console.log(`  ${data.length} rows, ${(html.length / 1024).toFixed(0)}KB`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
