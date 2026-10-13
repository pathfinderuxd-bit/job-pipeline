import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const L = (() => {
  const src = readFileSync(new URL('../src/letters.js', import.meta.url), 'utf8');
  const win = {};
  new Function('window', 'module', src)(win, undefined);
  return win.Letters;
})();

test('company and role fill every token', () => {
  const out = L.fill('Dear {{company}}, the {{ Role }} at {{company}}.', { company: 'Acme', role: 'Design Lead' });
  assert.equal(out, 'Dear Acme, the Design Lead at Acme.');
});
test('an empty why drops its whole line', () => {
  const out = L.fill('Hello\n\n{{why}}\n\nBye', { company: 'A', role: 'B', why: '' });
  assert.equal(out, 'Hello\n\nBye');
  assert.equal(L.fill('x {{why}}', { why: 'because' }), 'x because');
});
test('missing names stay visible', () => {
  assert.deepEqual(L.unfilled(L.fill('{{company}} {{role}}', { company: 'A' })), ['role']);
});
test('role keeps only the title before a dash', () => {
  assert.equal(L.roleName('Senior Designer — Remote'), 'Senior Designer');
});
