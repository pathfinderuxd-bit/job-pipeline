#!/usr/bin/env node
/* Dev server. Rebuilds on every request, so editing src/ or data/ and hitting
 * refresh is the whole loop.
 *
 *   node packages/tracker/bin/serve.mjs apps/rb [port]
 */
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILD = fileURLToPath(new URL('./build.mjs', import.meta.url));
const appDir = resolve(process.argv[2] ?? 'apps/rb');
const port = Number(process.argv[3] ?? 5173);

createServer((req, res) => {
  if (req.url === '/favicon.ico') return res.writeHead(204).end();
  const build = spawnSync(process.execPath, [BUILD, appDir], { encoding: 'utf8' });
  process.stdout.write(build.stdout ?? '');
  if (build.status !== 0) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Build failed\n\n' + (build.stderr ?? ''));
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(readFileSync(join(appDir, 'dist/index.html')));
}).listen(port, () => {
  console.log(`${appDir} on http://localhost:${port} — rebuilds on every refresh`);
});
