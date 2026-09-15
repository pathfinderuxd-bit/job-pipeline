#!/usr/bin/env node
/* Build one app into a single self-contained HTML file.
 *
 *   node packages/tracker/bin/build.mjs apps/rb
 *
 * Everything is inlined — CSS, JS, data, the LinkedIn mark as a data URI — so
 * the output opens from the filesystem, drops into any static host, and can be
 * published as a Claude artifact without a bundler. No dependencies.
 *
 * Two shapes, decided by `mode` in the app's tracker.config.json:
 *
 *   offline (default)  the data is baked in and the page renders at load.
 *   hosted             the page starts empty behind a Google sign-in, picks up
 *                      whoever signs in, and can refresh itself from Gmail.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(fileURLToPath(new URL('../src', import.meta.url)));

const appDir = resolve(process.argv[2] ?? '.');
if (!existsSync(join(appDir, 'tracker.config.json'))) {
  console.error(`No tracker.config.json in ${appDir}\nUsage: node packages/tracker/bin/build.mjs <app dir>`);
  process.exit(1);
}

const read = (p) => readFileSync(p, 'utf8');
const readJson = (p) => JSON.parse(read(p));
const src = (name) => read(join(SRC, name));

const config = readJson(join(appDir, 'tracker.config.json'));

/* Which build is this? Stamped into the page so a screenshot, a bug report or
 * a tab left open overnight all say which version they are, instead of the
 * three of us guessing from the look of it. */
const pkg = readJson(resolve(fileURLToPath(new URL('../../../package.json', import.meta.url))));
const build = {
  version: pkg.version,
  lineage: config.lineage ?? pkg.lineage ?? '',
  app: basename(appDir),
  theme: config.theme ?? 'v1',
  mode: config.mode ?? 'offline',
  builtAt: new Date().toISOString(),
};
/* site.json carries the masthead and the insight cards — prose that names
 * employers, so a real one is gitignored alongside the rows. Without it the
 * app still builds, just with a plain heading. */
const siteFile = join(appDir, 'data/site.json');
const site = existsSync(siteFile) ? readJson(siteFile) : {
  title: 'Job Pipeline',
  eyebrow: 'Live job tracker  ·  last updated {{UPDATED}}',
  standfirst: '{{N}} applications, {{LIVE}} live, {{WAIT}} awaiting a reply.',
  updated: 'auto', insights: [],
};
const hosted = config.mode === 'hosted';

// A London timestamp in the same DD/MM/YY:HH:MM shape the masthead has always used.
function stamp() {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: '2-digit', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.day}/${p.month}/${p.year}:${p.hour}:${p.minute}`;
}
if (!site.updated || site.updated === 'auto') site.updated = stamp();

// Offline apps carry one dataset. Hosted apps carry several, and whoever signs
// in picks one as a starting point.
let applications = [];
let baselines = {};
if (hosted) {
  for (const [id, b] of Object.entries(config.baselines ?? {})) {
    baselines[id] = { label: b.label ?? id, note: b.note ?? '',
                      rows: readJson(resolve(appDir, b.from)) };
  }
} else {
  /* Real rows are gitignored — they are nobody's business but the owner's — so
   * a fresh clone and CI find nothing here and build an empty tracker. Whoever
   * owns it keeps their data locally, or imports it into the hosted page. */
  const file = join(appDir, 'data/applications.json');
  applications = existsSync(file) ? readJson(file) : [];
}

const theme = config.theme === 'v2' ? 'v2.css' : 'v1.css';
const css = src(join('themes', theme));

const head = [
  `window.TRACKER_CONFIG = ${JSON.stringify({
    mode: config.mode ?? 'offline',
    storeKey: config.storeKey ?? `job-pipeline/${basename(appDir)}/v1`,
    googleClientId: config.googleClientId ?? '',
    sweepMonths: config.sweepMonths ?? 6,
    demo: config.demo ?? false,
    dropUnnamed: config.dropUnnamed ?? true,
  })};`,
  src('config.js'),
  `window.BUILD = ${JSON.stringify(build)};`,
  `window.SITE = ${JSON.stringify(site)};`,
  hosted
    ? `window.BASELINES = ${JSON.stringify(baselines)};\n` +
      `window.RULES = ${read(join(SRC, 'rules.json'))};`
    : `window.APPLICATIONS = ${JSON.stringify(applications)};`,
  src('merge.js'),
];

// Order matters: render.js and app.js define themselves, gate.js drives them.
/* cvstore.js and cvui.js load before render.js, because render.js asks cvui
 * for the contents of every CV dropdown as it draws the rows. chrome.js goes
 * with them: gate.js draws the sign-in card the moment it is evaluated, and
 * that card borrows the brand lockup from chrome.js — load it after and the
 * card silently falls back to a plain text eyebrow. */
const tail = hosted
  ? [src('store.js'), src('toast.js'), src('extract.js'), src('google.js'),
     src('cvstore.js'), src('cvui.js'), src('chrome.js'),
     src('render.js'), src('app.js'), src('gate.js')]
  : [src('toast.js'), src('cvstore.js'), src('cvui.js'), src('chrome.js'),
     src('render.js'), src('app.js')];

/* render.js draws the build line as part of the masthead, so there is nothing
 * left to boot here. */
const js = head.concat(tail).join('\n\n');

/* The replacement has to go in through a function. Given a plain string,
 * String.replace treats $&, $`, $' and $1 as insert-the-match patterns — and
 * the inlined JS legitimately contains '\\$&' inside a regex-escaping helper,
 * which silently pasted the matched <script> tags back into the output and
 * tripped the placeholder check below. A function replacement is taken
 * literally, so this cannot happen again whatever the code contains. */
const put = (value) => () => value;

const html = read(join(SRC, 'shell.html'))
  .replace('<link rel="stylesheet" href="theme.css">', put(`<style>\n${css}\n</style>`))
  .replace('<script src="data.js"></script>\n<script src="app.js"></script>',
           put(`<script>\n${js}\n</script>`))
  .replace('<title id="doc-title">Job Pipeline</title>',
           put(`<title id="doc-title">${site.title ?? 'Job Pipeline'}</title>`));

if (html.includes('<script src=') || html.includes('href="theme.css"')) {
  console.error('Build failed: shell placeholders did not all get replaced.');
  process.exit(1);
}

const out = join(appDir, 'dist');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'index.html'), html);

const size = `${(html.length / 1024).toFixed(0)}KB`;
if (hosted) {
  const names = Object.entries(baselines)
    .map(([id, b]) => `${id}:${b.rows.length}`).join(' ');
  const key = config.googleClientId ? 'client ID set' : 'NO CLIENT ID — see SETUP.md';
  console.log(`${basename(appDir)} → dist/index.html  hosted, baselines ${names}, ${key}, ${size}`);
} else {
  const counts = applications.reduce((a, x) => (a[x.status] = (a[x.status] ?? 0) + 1, a), {});
  console.log(
    `${basename(appDir)} → dist/index.html  ${applications.length} rows ` +
    `(${counts.live ?? 0} live / ${counts.wait ?? 0} awaiting / ` +
    `${counts.lead ?? 0} leads / ${counts.shut ?? 0} closed), ` +
    `theme ${config.theme ?? 'v1'}, ${size}`
  );
}
